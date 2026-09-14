import { queryClient } from '../../services/query-client'
import { wsClient } from '../../services/ws-client'
import { normalizeMessage, type SessionEventData, type TurnProcessItemInfo } from '../../stores/session-events'
import { turnFromProcessItems } from '../../stores/turn-blocks'
import { attachTeamAssignments, findPendingTeamAssignment, mapTeamMessage } from './team-chat-assignments'
import { emptySnapshot, mergeProcessItem, reduceRecovery, remapEvent, restoreTeamSnapshot, type Snapshot } from './team-chat-state'
import { shareTeamRequest, type SourceMessage } from './team-view-cache'

export interface LoadedTeamSession { snapshot: Snapshot; sources: Map<string, SourceMessage> }

/** 回合重放分页预算:移动端放宽单页(往返数 7-13 → 2-3),PC 保持历史值。 */
export interface TurnReplayPageBudget { maxItems: number; maxBytes: number }
export const PC_TURN_REPLAY_PAGE_BUDGET: TurnReplayPageBudget = { maxItems: 100, maxBytes: 128 * 1024 }
export const MOBILE_TURN_REPLAY_PAGE_BUDGET: TurnReplayPageBudget = { maxItems: 500, maxBytes: 512 * 1024 }
export function resolveTurnReplayPageBudget(profile: string | undefined): TurnReplayPageBudget {
  return profile?.trim().toLowerCase() === 'mobile' ? MOBILE_TURN_REPLAY_PAGE_BUDGET : PC_TURN_REPLAY_PAGE_BUDGET
}
const turnReplayPageBudget = resolveTurnReplayPageBudget(import.meta.env.VITE_TEAM_TURN_PAGE_PROFILE as string | undefined)

/** 基础快照(恢复边界 + 消息页)已可渲染;运行中回合的事件重放作为可选计划后台补齐。 */
export interface TeamTurnReplayPlan { messageId: string; throughSequence: number }
export interface LoadedTeamSessionBase extends LoadedTeamSession { replay: TeamTurnReplayPlan | null }

export function loadTeamMessagePage(scope: string, sessionId: string, masterSessionId: string, name: string, role: string): Promise<LoadedTeamSession> {
  return shareTeamRequest(`page:${scope}:${sessionId}`, async () => {
    const page = await queryClient.listSessionMessages({ sessionId, limit: 20, includeToolCalls: false, includeLatestToolCalls: false })
    const sources = new Map<string, SourceMessage>()
    const messages = page.items.map(message => {
      const display = normalizeMessage(mapTeamMessage(message, sessionId, masterSessionId, name, role))
      sources.set(display.id, { message: display, sourceSessionId: sessionId, sourceMessageId: message.id })
      return display
    })
    return { snapshot: { ...emptySnapshot(sessionId), senderName: name, messages, hasMore: page.hasMore }, sources }
  })
}

/**
 * 装载第一阶段:恢复边界 + 消息页。不做运行中回合的事件重放——消息页先交给 UI 渲染,
 * 重放计划(若存在)由 loadTeamTurnReplay 后台补齐,避免长回合的串行翻页拖住"加载中"。
 */
export function loadTeamSessionBase(scope: string, sessionId: string, masterSessionId: string, name: string, role: string): Promise<LoadedTeamSessionBase> {
  return shareTeamRequest(`messages:${scope}:${sessionId}`, async () => {
    // Recovery boundary precedes the message snapshot; subsequent live events
    // are merged by sequence in TeamChatPane.
    const recovery = await queryClient.getSessionRecovery({ sessionId, limit: 500 })
    const page = await loadTeamMessagePage(scope, sessionId, masterSessionId, name, role)
    const { sources } = page
    const mapped = page.snapshot.messages
    const decorated = attachTeamAssignments(mapped)
    const reduced = recovery.events.length ? reduceRecovery(recovery.events) : null
    const active = decorated.messages.filter(message => message.role === 'agent' && message.status === 'running').at(-1)
    const pendingAssignment = active?.teamAssignment || findPendingTeamAssignment(mapped)
    const base: Snapshot = { ...emptySnapshot(sessionId), senderName: name, messages: decorated.messages, events: recovery.events.map(event => remapEvent(event, sessionId, masterSessionId)), pendingAssignment, permissions: reduced?.pendingPermissions || [], elicitations: reduced?.pendingElicitations || [], usage: reduced?.usage || null, hasMore: page.snapshot.hasMore }
    // 无重放事件:streaming 先由消息页的 running 行兜底(replaySequence 仍钉在恢复边界,
    // 重放范围内的事件不会被实时流重复应用)。
    const snapshot = restoreTeamSnapshot(base, [], recovery.latestSequence)
    return { snapshot, sources, replay: active ? { messageId: active.id.slice(sessionId.length + 1), throughSequence: recovery.latestSequence } : null }
  })
}

/** 装载第二阶段(后台):运行中回合的事件分页 + 过程项,产出可并入当前状态的快照。 */
export async function loadTeamTurnReplay(sessionId: string, base: Snapshot, plan: TeamTurnReplayPlan): Promise<Snapshot> {
  const [turnEvents, processItems] = await Promise.all([
    loadTurnEvents(sessionId, plan.messageId, plan.throughSequence),
    wsClient.request({ type: 'sessions.messageProcess', sessionId, messageId: plan.messageId }) as Promise<TurnProcessItemInfo[]>,
  ])
  let restored = { [sessionId]: restoreTeamSnapshot(base, turnEvents, plan.throughSequence) }
  for (const item of processItems) {
    const block = turnFromProcessItems(item.message_id, [item]).processBlocks[0]
    if (block) restored = mergeProcessItem(restored, sessionId, item, block)
  }
  return restored[sessionId]
}

export interface TeamSessionProgressiveHandlers {
  /** 基础快照就绪:先渲染(加载态在此解除)。 */
  onBase(loaded: LoadedTeamSessionBase): void
  /** 后台回合重放完成:按团队合并语义并入,不重不漏。 */
  onReplay(snapshot: Snapshot): void
  /** 后台补齐失败:基础快照已渲染,仅上报,不阻塞会话装载。 */
  onReplayError?(error: unknown): void
  /** 加载代际校验:false = 结果已过期(重挂载/重新加载),丢弃。 */
  isActive(): boolean
}

/**
 * 两段式装载:基础快照先交付,运行中回合重放后台补齐。
 * 返回的 Promise 在基础快照交付后即 resolve——后台补齐不占用会话加载波次的并发额度。
 */
export function loadTeamSessionProgressive(scope: string, sessionId: string, masterSessionId: string, name: string, role: string, handlers: TeamSessionProgressiveHandlers): Promise<void> {
  return loadTeamSessionBase(scope, sessionId, masterSessionId, name, role).then((loaded) => {
    if (!handlers.isActive()) return
    handlers.onBase(loaded)
    if (!loaded.replay) return
    void loadTeamTurnReplay(sessionId, loaded.snapshot, loaded.replay)
      .then(snapshot => { if (handlers.isActive()) handlers.onReplay(snapshot) })
      .catch((error: unknown) => { if (handlers.isActive()) handlers.onReplayError?.(error) })
  })
}

async function loadTurnEvents(sessionId: string, messageId: string, throughSequence: number): Promise<SessionEventData[]> {
  const events: SessionEventData[] = []
  let afterSequence = 0
  for (;;) {
    const page = await wsClient.request({ type: 'sessions.messageEventsPage', sessionId, messageId, afterSequence, throughSequence, ...turnReplayPageBudget }) as { items: SessionEventData[]; nextSequence: number; hasMore: boolean }
    if (!Array.isArray(page.items) || !Number.isSafeInteger(page.nextSequence)) throw new Error('执行过程恢复响应无效')
    events.push(...page.items)
    if (!page.hasMore) return events
    if (page.nextSequence <= afterSequence) throw new Error('执行过程恢复游标未前进')
    afterSequence = page.nextSequence
  }
}
