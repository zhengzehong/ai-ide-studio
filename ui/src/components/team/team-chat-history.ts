import { queryClient } from '../../services/query-client'
import { normalizeMessage, type MessageData } from '../../stores/session-events'
import { attachTeamAssignments, mapTeamMessage } from './team-chat-assignments'
import type { Snapshot } from './team-chat-state'
import type { SourceMessage } from './team-view-cache'

export interface OlderTeamPage {
  sessionId: string
  messages: MessageData[]
  hasMore: boolean
  sources: [string, SourceMessage][]
}

export async function loadOlderTeamPages(snapshots: Record<string, Snapshot>, sessionIds: string[], masterSessionId: string): Promise<OlderTeamPage[]> {
  return Promise.all(sessionIds.filter(id => snapshots[id]?.hasMore).map(async sessionId => {
    const snapshot = snapshots[sessionId]
    const oldest = snapshot.messages[0]
    const page = await queryClient.listSessionMessages({ sessionId, limit: 40, before: oldest?.timestamp, includeToolCalls: true })
    const sources: [string, SourceMessage][] = []
    const messages = page.items.map(message => {
      const display = normalizeMessage(mapTeamMessage(message, sessionId, masterSessionId, snapshot.senderName || 'Agent', oldest?.sender_role || 'member'))
      sources.push([display.id, { message: display, sourceSessionId: sessionId, sourceMessageId: message.id }])
      return display
    })
    return { sessionId, messages, sources, hasMore: page.hasMore }
  }))
}

export function mergeOlderTeamPages(current: Record<string, Snapshot>, pages: OlderTeamPage[]): Record<string, Snapshot> {
  const next = { ...current }
  for (const page of pages) {
    const snapshot = next[page.sessionId]
    if (!snapshot) continue
    const messages = [...new Map([...page.messages, ...snapshot.messages].map(message => [message.id, message])).values()]
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))
    const decorated = attachTeamAssignments(messages, snapshot.streaming)
    next[page.sessionId] = { ...snapshot, messages: decorated.messages, streaming: decorated.streaming, hasMore: page.hasMore }
  }
  return next
}
