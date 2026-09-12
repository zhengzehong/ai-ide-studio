import { useCallback, useState } from 'react'
import type { MessageData, StreamingMessage } from '../../stores/session-events'
import type { ConversationAdapter } from '../chat/conversation-types'

export interface TeamActivity { id: string; name: string; messageId: string; running: boolean; unread: boolean }

export function buildTeamActivity(messages: MessageData[], streams: StreamingMessage[], agentIds: Record<string, string>, seen: ReadonlySet<string>, openedAt: number): TeamActivity[] {
  const members = new Map<string, TeamActivity>()
  const memberId = (id: string): string => { const source = id.split(':')[0]; return agentIds[source] || source }
  for (const message of messages) {
    if (message.role !== 'agent' || message.status === 'running' || seen.has(message.id)) continue
    if (Date.parse(message.completed_at || message.timestamp) < openedAt) continue
    const id = memberId(message.id)
    members.set(id, { id, name: message.sender_name || 'Agent', messageId: message.id, running: false, unread: true })
  }
  for (const stream of streams) {
    if (stream.done) continue
    const id = memberId(stream.id)
    members.set(id, { id, name: stream.senderName || 'Agent', messageId: stream.id, running: true, unread: members.get(id)?.unread || false })
  }
  return [...members.values()]
}

// The parent team pane is keyed by conversation. These are local attention hints,
// independent of the server's conversation-list read watermark.
export function useTeamActivity(adapter: ConversationAdapter, enabled: boolean): { members: TeamActivity[]; markSeen: (id: string) => void } {
  const [openedAt] = useState(Date.now)
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set())
  const markSeen = useCallback((id: string): void => {
    setSeen(current => current.has(id) ? current : new Set([...current, id]))
  }, [])
  return {
    members: enabled ? buildTeamActivity(adapter.messages, adapter.streamingMessages || (adapter.streamingMessage ? [adapter.streamingMessage] : []), adapter.senderAgentIds || {}, seen, openedAt) : [],
    markSeen,
  }
}
