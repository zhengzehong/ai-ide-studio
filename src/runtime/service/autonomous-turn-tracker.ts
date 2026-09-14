import { createChildLogger } from '../../shared/logger.js'
import { hasAutonomousOriginMeta } from '../../shared/autonomous-turn.js'

const log = createChildLogger('autonomous-turn-tracker')

/** turn-scoped 会话更新类型,与 acp-runtime-client 的守卫集合保持同源。 */
export const TURN_SCOPED_UPDATE_TYPES: readonly string[] = [
  'agent_message_chunk',
  'agent_thought_chunk',
  'tool_call',
  'tool_call_update',
  'usage_update',
  'plan',
  'user_message_chunk',
]

/**
 * 只有"模型新产出"类型的无绑定帧才开启自治回合;
 * usage_update / tool_call_update 是弱帧——正常回合的 trailing 尾帧(幽灵)与
 * 取消回合的孤儿工具更新都属于弱帧,它们绝不触发起始,直接丢弃(不物化、不闪回合)。
 */
const STRONG_OPEN_TYPES = new Set([
  'agent_thought_chunk',
  'agent_message_chunk',
  'tool_call',
  'plan',
  'user_message_chunk',
])

const TOOL_STATE_TYPES = new Set(['tool_call', 'tool_call_update'])
const ACTIVE_TOOL_STATUSES = new Set(['pending', 'in_progress'])

/** 结构化的 ACP turn-scoped 更新子集(与 acp.SessionUpdate 兼容,便于单测解耦)。 */
export interface TurnScopedUpdateLike {
  sessionUpdate: string
  toolCallId?: string | null
  status?: string | null
  _meta?: unknown
}

export interface AutonomousTurnTimings {
  /** 无终结帧时的基础静默阈值;存在未完成 tool 时不结算。 */
  silenceMs: number
  /** 终结帧(usage_update 带 origin meta)后的合并窗口:窗口内仍有新帧则视为连续 cycle,继续等待。 */
  originSettleDebounceMs: number
  /** 收到取消请求后的静默阈值(缩短,尽快收敛)。 */
  cancelSilenceMs: number
  /** 收到取消请求后的硬截止:无论 tool 状态如何都必须结算。 */
  cancelDeadlineMs: number
  /** 单回合硬上限,防止挂死 tool 导致永久豁免。 */
  maxTurnMs: number
  /** 正常回合结束后的"幽灵判定"窗口(仅用于丢弃分类日志)。 */
  postTurnGhostMs: number
}

export const DEFAULT_AUTONOMOUS_TURN_TIMINGS: AutonomousTurnTimings = {
  silenceMs: 12_000,
  originSettleDebounceMs: 800,
  // 必须小于升级阶梯的 cancelGraceMs(host 默认 800,见 sdk-runtime-host.ts):
  // 否则 settlesWithin(800ms) 必败,用户 stop 常态直接升级到 session-close(比必要更重)。
  cancelSilenceMs: 400,
  cancelDeadlineMs: 8_000,
  maxTurnMs: 60 * 60 * 1000,
  postTurnGhostMs: 3_000,
}

export type AutonomousDropKind = 'post-turn-ghost' | 'unbound-weak-frame' | 'unsupported-frame'

export type AutonomousSettleReason =
  | 'origin-signal'
  | 'silence'
  | 'real-turn'
  | 'cancel'
  | 'disposed'
  | 'max-duration'

export type AutonomousStopReason = 'end_turn' | 'cancelled' | 'error'

export interface AutonomousTurnTrackerOptions {
  /** 打开合成回合:host 完成注册(activity running、注记、turns 登记等)并返回合成 messageId;返回 null 表示不可打开。 */
  openTurn(sessionId: string): string | null
  /** 结算合成回合:host 完成收尾(解绑、turns 复位、合成 done、activity idle)。 */
  settleTurn(sessionId: string, input: {
    messageId: string
    stopReason: AutonomousStopReason
    error?: string
    reason: AutonomousSettleReason
  }): void
  onFrameDropped?(sessionId: string, updateType: string, kind: AutonomousDropKind): void
  now?(): number
  timings?: Partial<AutonomousTurnTimings>
}

interface OpenAutonomousTurn {
  messageId: string
  openedAt: number
  originSignaledAt?: number
  cancelRequestedAt?: number
  tools: Map<string, string>
  silenceTimer?: ReturnType<typeof setTimeout>
  originTimer?: ReturnType<typeof setTimeout>
  maxTimer?: ReturnType<typeof setTimeout>
}

/**
 * 自治回合状态机(host 侧,每平台一个实例,按 sessionId 维护)。
 *
 * - 无绑定强帧 → 开合成回合;
 * - 无绑定弱帧 → 直接丢弃(幽灵/取消残留分类仅用于日志);
 * - 回合内:tool 状态跟踪;用法终端的 origin meta 终结帧做确定性结算,静默超时兜底;
 * - 存在未完成 tool 不静默结算;真回合 begin 互斥结算;取消请求走短静默+硬截止。
 */
export class AutonomousTurnTracker {
  private readonly turns = new Map<string, OpenAutonomousTurn>()
  private readonly timings: AutonomousTurnTimings
  private readonly now: () => number
  private lastRealTurnEndedAt = 0

  constructor(private readonly options: AutonomousTurnTrackerOptions) {
    this.timings = { ...DEFAULT_AUTONOMOUS_TURN_TIMINGS, ...options.timings }
    this.now = options.now ?? Date.now
  }

  isOpen(sessionId: string): boolean {
    return this.turns.has(sessionId)
  }

  /** 无绑定的 turn-scoped 帧:强帧开回合,弱帧/不支持帧丢弃。返回本帧应发布到的 messageId。 */
  handleUnboundFrame(sessionId: string, update: TurnScopedUpdateLike): string | null {
    const open = this.turns.get(sessionId)
    if (open) return open.messageId
    if (STRONG_OPEN_TYPES.has(update.sessionUpdate)) {
      const messageId = this.options.openTurn(sessionId)
      if (!messageId) return null
      const turn: OpenAutonomousTurn = { messageId, openedAt: this.now(), tools: new Map() }
      this.turns.set(sessionId, turn)
      // 开场帧本身也要过一遍观察逻辑(tool 状态/静默续期);客户端随后还会对同帧调 observeFrame,重复调用是幂等的。
      this.observeFrame(sessionId, update)
      turn.maxTimer = setTimeout(() => {
        log.warn({ sessionId, messageId: turn.messageId, elapsedMs: this.now() - turn.openedAt }, 'autonomous turn hit max duration; force settling')
        this.settle(sessionId, turn, 'max-duration', 'end_turn')
      }, this.timings.maxTurnMs)
      turn.maxTimer.unref?.()
      log.info({ sessionId, messageId, updateType: update.sessionUpdate }, 'autonomous turn started')
      return messageId
    }
    const kind: AutonomousDropKind = TURN_SCOPED_UPDATE_TYPES.includes(update.sessionUpdate)
      ? (this.now() - this.lastRealTurnEndedAt <= this.timings.postTurnGhostMs ? 'post-turn-ghost' : 'unbound-weak-frame')
      : 'unsupported-frame'
    this.options.onFrameDropped?.(sessionId, update.sessionUpdate, kind)
    return null
  }

  /** 观察每一帧 turn-scoped 更新(无论绑定与否):tool 状态、终结帧、静默续期。 */
  observeFrame(sessionId: string, update: TurnScopedUpdateLike): void {
    const turn = this.turns.get(sessionId)
    if (!turn) return
    if (TOOL_STATE_TYPES.has(update.sessionUpdate) && typeof update.toolCallId === 'string') {
      const status = typeof update.status === 'string' ? update.status : turn.tools.get(update.toolCallId)
      if (typeof status === 'string') turn.tools.set(update.toolCallId, status)
    }
    if (update.sessionUpdate === 'usage_update' && hasAutonomousOriginMeta(update._meta)) {
      turn.originSignaledAt = this.now()
    }
    this.armSilence(sessionId, turn)
    this.armOriginDebounce(sessionId, turn)
  }

  /** 真回合开始 → 立即结算合成回合(互斥,防内容串段)。 */
  onRealTurnBegin(sessionId: string): void {
    const turn = this.turns.get(sessionId)
    if (turn) this.settle(sessionId, turn, 'real-turn', 'end_turn')
  }

  /** 真回合结束 → 记录幽灵判定窗口(其后的弱帧按 post-turn-ghost 分类丢弃)。 */
  onRealTurnEnd(_sessionId: string): void {
    this.lastRealTurnEndedAt = this.now()
  }

  /** 取消请求 → 进入快速收敛模式(短静默 + 硬截止)。 */
  requestCancel(sessionId: string): void {
    const turn = this.turns.get(sessionId)
    if (!turn || turn.cancelRequestedAt !== undefined) return
    turn.cancelRequestedAt = this.now()
    log.info({ sessionId, messageId: turn.messageId }, 'autonomous turn cancel requested')
    this.armSilence(sessionId, turn)
  }

  /** agent 退出 / session 关闭等清理路径:结算合成回合并清空定时器。 */
  disposeSession(sessionId: string, input: { stopReason: AutonomousStopReason; error?: string }): void {
    const turn = this.turns.get(sessionId)
    if (turn) this.settle(sessionId, turn, 'disposed', input.stopReason, input.error)
  }

  disposeAll(input: { stopReason: AutonomousStopReason; error?: string }): void {
    for (const sessionId of [...this.turns.keys()]) this.disposeSession(sessionId, input)
  }

  private settle(
    sessionId: string,
    turn: OpenAutonomousTurn,
    reason: AutonomousSettleReason,
    stopReason: AutonomousStopReason,
    error?: string,
  ): void {
    if (this.turns.get(sessionId) !== turn) return
    this.turns.delete(sessionId)
    this.clearTimers(turn)
    log.info(
      { sessionId, messageId: turn.messageId, reason, stopReason, elapsedMs: this.now() - turn.openedAt },
      'autonomous turn settled',
    )
    try {
      this.options.settleTurn(sessionId, {
        messageId: turn.messageId,
        stopReason,
        ...(error !== undefined ? { error } : {}),
        reason,
      })
    } catch (err) {
      log.error({ err, sessionId, messageId: turn.messageId }, 'autonomous turn settle callback failed')
    }
  }

  private onSilence(sessionId: string, turn: OpenAutonomousTurn): void {
    if (this.turns.get(sessionId) !== turn) return
    const cancelRequested = turn.cancelRequestedAt !== undefined
    if (cancelRequested && this.now() - (turn.cancelRequestedAt ?? 0) >= this.timings.cancelDeadlineMs) {
      this.settle(sessionId, turn, 'cancel', 'cancelled')
      return
    }
    if (this.hasActiveTools(turn)) {
      // 存在未完成 tool 就不静默结算(工具心跳最长 30s 量级,等待其完成或终结帧)。
      this.armSilence(sessionId, turn)
      return
    }
    this.settle(sessionId, turn, cancelRequested ? 'cancel' : 'silence', cancelRequested ? 'cancelled' : 'end_turn')
  }

  private hasActiveTools(turn: OpenAutonomousTurn): boolean {
    return [...turn.tools.values()].some((status) => ACTIVE_TOOL_STATUSES.has(status))
  }

  private armSilence(sessionId: string, turn: OpenAutonomousTurn): void {
    if (turn.silenceTimer) clearTimeout(turn.silenceTimer)
    const delay = turn.cancelRequestedAt !== undefined ? this.timings.cancelSilenceMs : this.timings.silenceMs
    turn.silenceTimer = setTimeout(() => this.onSilence(sessionId, turn), delay)
    turn.silenceTimer.unref?.()
  }

  private armOriginDebounce(sessionId: string, turn: OpenAutonomousTurn): void {
    if (turn.originSignaledAt === undefined) return
    if (turn.originTimer) clearTimeout(turn.originTimer)
    turn.originTimer = setTimeout(() => {
      if (this.turns.get(sessionId) !== turn) return
      // 与 silence 路径对齐的两个守卫:
      // ① 已在取消流程 → 落"已取消":被取消周期仍可能发带 origin meta 的 result 帧,
      //    直接按 origin 结算会把用户 stop 掉的回合标成"完成"(用户可见错误)。
      if (turn.cancelRequestedAt !== undefined) {
        this.settle(sessionId, turn, 'cancel', 'cancelled')
        return
      }
      // ② 工具仍在进行 → 不中途结算(跨 cycle 合并窗口内 >800ms 帧间隙 + 工具活跃会误结算,
      //    导致工具条目永久 in_progress、后续 tool_call_update 被丢弃)。转由 silence 判据续期,
      //    origin 标记保留:工具完成帧到达后会重新触发 debounce,尽快收敛。
      if (this.hasActiveTools(turn)) {
        this.armSilence(sessionId, turn)
        return
      }
      this.settle(sessionId, turn, 'origin-signal', 'end_turn')
    }, this.timings.originSettleDebounceMs)
    turn.originTimer.unref?.()
  }

  private clearTimers(turn: OpenAutonomousTurn): void {
    if (turn.silenceTimer) clearTimeout(turn.silenceTimer)
    if (turn.originTimer) clearTimeout(turn.originTimer)
    if (turn.maxTimer) clearTimeout(turn.maxTimer)
    turn.silenceTimer = undefined
    turn.originTimer = undefined
    turn.maxTimer = undefined
  }
}