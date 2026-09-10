import { queryClient } from '../../services/query-client'
import { wsClient } from '../../services/ws-client'
import { normalizeMessage, type SessionEventData, type TurnProcessItemInfo } from '../../stores/session-events'
import { turnFromProcessItems } from '../../stores/turn-blocks'
import { attachTeamAssignments, findPendingTeamAssignment, mapTeamMessage } from './team-chat-assignments'
import { emptySnapshot, mergeProcessItem, reduceRecovery, remapEvent, restoreTeamSnapshot, type Snapshot } from './team-chat-state'
import { shareTeamRequest, type SourceMessage } from './team-view-cache'

export interface LoadedTeamSession { snapshot: Snapshot; sources: Map<string, SourceMessage> }

export function loadTeamSession(scope: string, sessionId: string, masterSessionId: string, name: string, role: string): Promise<LoadedTeamSession> {
  return shareTeamRequest(`messages:${scope}:${sessionId}`, async () => {
    // Recovery boundary precedes the message snapshot; subsequent live events
    // are merged by sequence in TeamChatPane.
    const recovery = await queryClient.getSessionRecovery({ sessionId, limit: 1000 })
    const page = await queryClient.listSessionMessages({ sessionId, limit: 120, includeToolCalls: true, includeLatestToolCalls: true })
    const sources = new Map<string, SourceMessage>()
    const mapped = page.items.map(message => {
      const display = normalizeMessage(mapTeamMessage(message, sessionId, masterSessionId, name, role))
      sources.set(display.id, { message: display, sourceSessionId: sessionId, sourceMessageId: message.id })
      return display
    })
    const decorated = attachTeamAssignments(mapped)
    const reduced = recovery.events.length ? reduceRecovery(recovery.events) : null
    const active = decorated.messages.filter(message => message.role === 'agent' && message.status === 'running').at(-1)
    const pendingAssignment = active?.teamAssignment || findPendingTeamAssignment(mapped)
    const [turnEvents, processItems] = active ? await Promise.all([
      wsClient.request({ type: 'sessions.messageEvents', sessionId, messageId: active.id.slice(sessionId.length + 1) }) as Promise<SessionEventData[]>,
      wsClient.request({ type: 'sessions.messageProcess', sessionId, messageId: active.id.slice(sessionId.length + 1) }) as Promise<TurnProcessItemInfo[]>,
    ]) : [[], []]
    const base: Snapshot = { ...emptySnapshot(sessionId), senderName: name, messages: decorated.messages, events: recovery.events.map(event => remapEvent(event, sessionId, masterSessionId)), pendingAssignment, permissions: reduced?.pendingPermissions || [], elicitations: reduced?.pendingElicitations || [], usage: reduced?.usage || null, hasMore: page.hasMore }
    let restored = { [sessionId]: restoreTeamSnapshot(base, turnEvents, recovery.latestSequence) }
    for (const item of processItems) {
      const block = turnFromProcessItems(item.message_id, [item]).processBlocks[0]
      if (block) restored = mergeProcessItem(restored, sessionId, item, block)
    }
    return { snapshot: restored[sessionId], sources }
  })
}
