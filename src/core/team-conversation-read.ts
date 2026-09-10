import { messageStore, sessionStore } from '../store/sessions.js'
import { teamConversationStore } from '../store/team-conversations.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('team-conversation-read')
interface ReadReference { sessionId: string; messageId: string }

export function markTeamConversationRead(conversationId: string, references: unknown): { sessionId: string; lastReadAt: string }[] {
  const conversation = teamConversationStore.get(conversationId)
  if (!conversation || conversation.status === 'deleted') throw new Error('团队会话不存在')
  if (!Array.isArray(references) || references.length > 100) throw new Error('已读消息列表无效')
  const members = new Set([conversation.master_session_id, ...teamConversationStore.listMembers(conversationId).map(member => member.session_id)])
  // Validate the entire batch before writing; the client cannot mark unrelated Sessions.
  const updates = references.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('已读消息无效')
    const ref = value as Partial<ReadReference>
    if (typeof ref.sessionId !== 'string' || typeof ref.messageId !== 'string' || !members.has(ref.sessionId)) throw new Error('消息不属于当前团队会话')
    const message = messageStore.get(ref.messageId)
    const session = sessionStore.get(ref.sessionId)
    if (!message || !session || message.session_id !== ref.sessionId || message.status === 'running') throw new Error('消息尚未完成或不存在')
    const latest = messageStore.list(ref.sessionId, { limit: 1 })[0]
    const boundary = latest?.id === message.id ? session.last_message_at || message.timestamp : message.completed_at || message.timestamp
    return { sessionId: session.id, lastReadAt: session.last_read_at && session.last_read_at > boundary ? session.last_read_at : boundary }
  })
  const fences = new Map<string, string>()
  for (const update of updates) {
    if (!fences.has(update.sessionId) || fences.get(update.sessionId)! < update.lastReadAt) fences.set(update.sessionId, update.lastReadAt)
  }
  const result = [...fences].map(([sessionId, timestamp]) => {
    const lastReadAt = sessionStore.markRead(sessionId, timestamp)
    events.emit('session:changed', { sessionId, data: { last_read_at: lastReadAt } })
    return { sessionId, lastReadAt }
  })
  log.debug({ conversationId, count: result.length }, 'Team conversation read fences applied')
  return result
}
