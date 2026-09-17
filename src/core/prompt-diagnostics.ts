import { randomUUID } from 'node:crypto'
import type { SessionActivityReason, SessionUpdateData } from '../types/ws-protocol.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('prompt-diagnostics')

const PROMPT_WATCHDOG_MS = readPositiveMs(process.env.PROMPT_WATCHDOG_MS, 60_000)
const PROMPT_WATCHDOG_INTERVAL_MS = readPositiveMs(process.env.PROMPT_WATCHDOG_INTERVAL_MS, 30_000)
const DEFAULT_STUCK_RECOVER_MS = 30 * 60 * 1000
/** 自动收敛的最小阈值:低于 30 分钟一律按 30 分钟(活回合长静默是真实存在的)。 */
const MIN_STUCK_RECOVER_MS = 30 * 60 * 1000
const activePromptDiagnostics = new Map<string, PromptDiagnosticState>()
let promptWatchdogTimer: ReturnType<typeof setInterval> | null = null

/**
 * 卡死自愈(分级,2026-09-17 sess-d83044f2 事故):
 * - 级别 a(人工):会话详情里"强制结束/恢复"由 sessions.forceFinishPrompt 提供,不依赖这里;
 * - 级别 b(自动,默认关闭):必须同时满足"存在排队消息" + "无任何流事件 ≥ autoRecoverSilentMs"。
 *   本案反例:活着的回合可以静默 2h08m 后仍产出真答案——因此自动动作必须保守,
 *   且真正的安全垫是"终稿可从 session_events 只读还原"(message-recovery)。
 *   注意:安全垫是 lastProgressAt(所有上行流帧,含工具心跳映射帧,经
 *   core/sessions.ts 的 session:update 路径刷新);不再有独立的心跳否决位——
 *   ACP 心跳只存在于 runtime 子进程/embedded 的 acp 会话键下,API 进程的诊断态
 *   永远看不到它(N2/P2-6),保留一个永不生效的判据只会误导交付说明。
 */
export interface PromptWatchdogHooks {
  /** 该会话是否有排队等待的提示(只有卡死才会积压,长工具不会)。 */
  hasQueuedMessages?: (sessionId: string) => boolean
  /** 与死亡清理同一条路径:置终态 + 清 activePrompt + drain 队列。 */
  forceFinish?: (sessionId: string, reason: 'watchdog') => void
}

export interface PromptWatchdogSettings {
  autoRecoverEnabled: boolean
  autoRecoverSilentMs: number
}

const settings: PromptWatchdogSettings = {
  autoRecoverEnabled: false,
  // 初值同样过硬钳制(所有入口都经 app.ts 覆盖,这里只是不留裸值,N6)。
  autoRecoverSilentMs: Math.max(
    MIN_STUCK_RECOVER_MS,
    readPositiveMs(process.env.PROMPT_STUCK_RECOVER_MS, DEFAULT_STUCK_RECOVER_MS),
  ),
}
const hooks: PromptWatchdogHooks = {}

/** 由 app 启动时注入配置开关、由 sessions 注入队列/收敛回调(避免 core 内循环依赖)。 */
export function configurePromptWatchdog(update: {
  autoRecoverEnabled?: boolean
  autoRecoverSilentMs?: number
  hooks?: PromptWatchdogHooks
}): void {
  if (update.autoRecoverEnabled !== undefined) settings.autoRecoverEnabled = update.autoRecoverEnabled
  if (update.autoRecoverSilentMs !== undefined && update.autoRecoverSilentMs > 0) {
    settings.autoRecoverSilentMs = Math.max(MIN_STUCK_RECOVER_MS, update.autoRecoverSilentMs)
  }
  if (update.hooks) Object.assign(hooks, update.hooks)
}

export interface PromptDiagnosticState {
  turnId: string
  sessionId: string
  agentId: string
  projectId?: string | null
  startedAt: number
  lastProgressAt: number
  lastProgress: string
  warnedAt?: number
  /** 已触发过自动收敛,等待生效期间不再重复触发。 */
  stuckActionAt?: number
}

export function createTurnId(): string {
  return `turn-${randomUUID().slice(0, 8)}`
}

export function startPromptDiagnostics(state: PromptDiagnosticState): void {
  activePromptDiagnostics.set(state.sessionId, state)
  ensurePromptWatchdog()
}

export function recordPromptProgress(sessionId: string, progress: string): void {
  const state = activePromptDiagnostics.get(sessionId)
  if (!state) return
  state.lastProgressAt = Date.now()
  state.lastProgress = progress
}

export function getPromptDiagnosticState(sessionId: string): PromptDiagnosticState | undefined {
  return activePromptDiagnostics.get(sessionId)
}

export function finishPromptDiagnostics(sessionId: string, reason: SessionActivityReason): void {
  const state = activePromptDiagnostics.get(sessionId)
  if (!state) return
  activePromptDiagnostics.delete(sessionId)
  log.debug(
    { sessionId, agentId: state.agentId, turnId: state.turnId, reason, elapsedMs: Date.now() - state.startedAt, lastProgress: state.lastProgress },
    'prompt diagnostics finished',
  )
}

export function getPromptTurnId(sessionId: string): string | undefined {
  return activePromptDiagnostics.get(sessionId)?.turnId
}

export function listActivePromptDiagnostics(): PromptDiagnosticState[] {
  return [...activePromptDiagnostics.values()].map((state) => ({ ...state }))
}

export function summarizeSessionUpdate(data: SessionUpdateData): string {
  if (data.contentDelta || data.content) return data.eventType || 'message.chunk'
  if (data.thinking) return 'thinking.chunk'
  if (data.toolCall) return `tool.call:${data.toolCall.id}`
  if (data.toolCallUpdate) return `tool.update:${data.toolCallUpdate.id}:${data.toolCallUpdate.status ?? 'unknown'}`
  if (data.usage) return 'usage.update'
  if (data.turnUsage) return 'turn.usage.update'
  if (data.plan) return 'plan.update'
  if (data.configOptions) return 'config.update'
  if (data.commands) return 'commands.update'
  if (data.sessionInfo) return 'session.info'
  if (data.permissionRequest) return `permission.request:${data.permissionRequest.id}`
  if (data.elicitationRequest) return `elicitation.request:${data.elicitationRequest.id}`
  if (data.attachments) return 'message.attachments'
  return data.eventType || 'session.update'
}

export function summarizeSessionUpdateData(data: SessionUpdateData): Record<string, unknown> {
  return {
    messageId: data.messageId,
    role: data.role,
    updateType: summarizeSessionUpdate(data),
    contentDeltaLength: data.contentDelta?.length,
    contentLength: data.content?.length,
    thinkingLength: data.thinking?.length,
    toolCallId: data.toolCall?.id ?? data.toolCallUpdate?.id,
    toolStatus: data.toolCall?.status ?? data.toolCallUpdate?.status,
    hasUsage: !!data.usage,
    hasTurnUsage: !!data.turnUsage,
    planCount: data.plan?.length,
  }
}

function readPositiveMs(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function ensurePromptWatchdog(): void {
  if (promptWatchdogTimer || PROMPT_WATCHDOG_MS <= 0 || PROMPT_WATCHDOG_INTERVAL_MS <= 0) return
  promptWatchdogTimer = setInterval(runPromptWatchdog, PROMPT_WATCHDOG_INTERVAL_MS)
  promptWatchdogTimer.unref?.()
}

function runPromptWatchdog(): void {
  if (activePromptDiagnostics.size === 0) return
  const now = Date.now()
  for (const state of activePromptDiagnostics.values()) {
    const activeForMs = now - state.startedAt
    const idleForMs = now - state.lastProgressAt
    if (idleForMs >= PROMPT_WATCHDOG_MS && !(state.warnedAt && now - state.warnedAt < PROMPT_WATCHDOG_MS)) {
      state.warnedAt = now
      log.warn(
        {
          sessionId: state.sessionId,
          agentId: state.agentId,
          projectId: state.projectId,
          turnId: state.turnId,
          activeForMs,
          idleForMs,
          lastProgress: state.lastProgress,
          lastProgressAt: new Date(state.lastProgressAt).toISOString(),
        },
        'active prompt watchdog warning',
      )
    }
    maybeAutoRecover(state, now, idleForMs)
  }
}

/** 级别 b 自动收敛:保守两条件(排队积压 + 流事件静默 ≥ 阈值),默认关闭。 */
function maybeAutoRecover(state: PromptDiagnosticState, now: number, idleForMs: number): void {
  if (!settings.autoRecoverEnabled || state.stuckActionAt !== undefined) return
  if (idleForMs < settings.autoRecoverSilentMs) return
  if (!hooks.hasQueuedMessages?.(state.sessionId)) return
  if (!hooks.forceFinish) return
  state.stuckActionAt = now
  log.warn(
    {
      sessionId: state.sessionId,
      agentId: state.agentId,
      projectId: state.projectId,
      turnId: state.turnId,
      activeForMs: now - state.startedAt,
      idleForMs,
      silentMs: settings.autoRecoverSilentMs,
      lastProgress: state.lastProgress,
      lastProgressAt: new Date(state.lastProgressAt).toISOString(),
    },
    'active prompt stuck with queued messages; forcing finish (auto recover)',
  )
  hooks.forceFinish(state.sessionId, 'watchdog')
}
