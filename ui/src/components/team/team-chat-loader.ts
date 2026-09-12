import { queryClient } from '../../services/query-client'
import { wsClient } from '../../services/ws-client'
import { normalizeMessage, type SessionEventData, type TurnProcessItemInfo } from '../../stores/session-events'
import { turnFromProcessItems } from '../../stores/turn-blocks'
import { attachTeamAssignments, findPendingTeamAssignment, mapTeamMessage } from './team-chat-assignments'
import { emptySnapshot, mergeProcessItem, reduceRecovery, remapEvent, restoreTeamSnapshot, type Snapshot } from './team-chat-state'
import { shareTeamRequest, type SourceMessage } from './team-view-cache'

export interface LoadedTeamSession { snapshot: Snapshot; sources: Map<string, SourceMessage> }

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

export function loadTeamSession(scope: string, sessionId: string, masterSessionId: string, name: string, role: string): Promise<LoadedTeamSession> {
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
    const [turnEvents, processItems] = active ? await Promise.all([
      loadTurnEvents(sessionId, active.id.slice(sessionId.length + 1), recovery.latestSequence),
      wsClient.request({ type: 'sessions.messageProcess', sessionId, messageId: active.id.slice(sessionId.length + 1) }) as Promise<TurnProcessItemInfo[]>,
    ]) : [[], []]
    const base: Snapshot = { ...emptySnapshot(sessionId), senderName: name, messages: decorated.messages, events: recovery.events.map(event => remapEvent(event, sessionId, masterSessionId)), pendingAssignment, permissions: reduced?.pendingPermissions || [], elicitations: reduced?.pendingElicitations || [], usage: reduced?.usage || null, hasMore: page.snapshot.hasMore }
    let restored = { [sessionId]: restoreTeamSnapshot(base, turnEvents, recovery.latestSequence) }
    for (const item of processItems) {
      const block = turnFromProcessItems(item.message_id, [item]).processBlocks[0]
      if (block) restored = mergeProcessItem(restored, sessionId, item, block)
    }
    return { snapshot: restored[sessionId], sources }
  })
}

async function loadTurnEvents(sessionId: string, messageId: string, throughSequence: number): Promise<SessionEventData[]> {
  const events: SessionEventData[] = []
  let afterSequence = 0
  for (;;) {
    const page = await wsClient.request({ type: 'sessions.messageEventsPage', sessionId, messageId, afterSequence, throughSequence }) as { items: SessionEventData[]; nextSequence: number; hasMore: boolean }
    if (!Array.isArray(page.items) || !Number.isSafeInteger(page.nextSequence)) throw new Error('执行过程恢复响应无效')
    events.push(...page.items)
    if (!page.hasMore) return events
    if (page.nextSequence <= afterSequence) throw new Error('执行过程恢复游标未前进')
    afterSequence = page.nextSequence
  }
}
