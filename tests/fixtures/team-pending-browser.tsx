import { createRoot } from 'react-dom/client'
import { TeamChatPane } from '../../ui/src/components/team/TeamChatPane'
import { wsClient } from '../../ui/src/services/ws-client'
import { queryClient } from '../../ui/src/services/query-client'
import { commandClient } from '../../ui/src/services/command-client'
import { defaultCaps, normalizeMessage, type MessageData, type SessionEventData } from '../../ui/src/stores/session-events'
import '../../ui/src/index.css'

const handlers = new Map<string, Set<(message: Record<string, unknown>) => void>>()
const messages: Record<string, MessageData[]> = { master: [], member: [] }
const events: Record<string, SessionEventData[]> = { master: [], member: [] }
const replies: Record<string, string> = {}
let inputCount = 0
let recoveryCount = 0
let messagePageCount = 0
const emit = (type: string, message: Record<string, unknown>): void => { handlers.get(type)?.forEach(handler => handler(message)) }
function appendEvent(sessionId: string, messageId: string, type: string, payload: Record<string, unknown> = {}, notify = true): void {
  const sequence = events[sessionId].length + 1
  const event: SessionEventData = { id: `${sessionId}-e${sequence}`, session_id: sessionId, message_id: messageId, sequence, type, payload_json: JSON.stringify({ messageId, ...payload }), created_at: new Date().toISOString() }
  events[sessionId].push(event)
  if (notify) emit('session:event', { sessionId, event })
}

wsClient.on = (type, handler): (() => void) => {
  const listeners = handlers.get(type) || new Set()
  listeners.add(handler); handlers.set(type, listeners)
  return (): void => { listeners.delete(handler) }
}
wsClient.subscribe = (): void => {}
wsClient.unsubscribe = (): void => {}
wsClient.acknowledgeResync = (): void => {}
wsClient.request = async (request): Promise<unknown> => {
  if (request.type === 'team.conversation.history') return { members: [{ id: 'c', session_id: 'member', agent_id: 'agent-c', name: '体检员 C', role: 'member' }] }
  if (request.type === 'session.getModels') return defaultCaps
  if (request.type === 'sessions.messageProcess') return []
  if (request.type === 'sessions.messageEventsPage') {
    const items = events[String(request.sessionId)].filter(event => event.message_id === request.messageId && event.sequence <= Number(request.throughSequence))
    return { items, nextSequence: items.at(-1)?.sequence || 0, hasMore: false }
  }
  return {}
}
queryClient.listSessionMessages = async ({ sessionId }) => { messagePageCount++; return { items: structuredClone(messages[sessionId] || []), hasMore: false, nextCursor: null } }
queryClient.getSessionRecovery = async ({ sessionId }) => {
  recoveryCount++
  const all = events[sessionId] || []
  return { sessionId, latestSequence: all.at(-1)?.sequence || 0, events: structuredClone(all.filter(event => !['message.chunk', 'thinking.chunk', 'tool.call', 'tool.update', 'message.done'].includes(event.type))) }
}
commandClient.execute = async command => {
  if (command.type === 'prompt') {
    inputCount++
    const timestamp = new Date().toISOString()
    const replyId = `reply-${inputCount}`
    replies.master = replyId
    messages.master.push(normalizeMessage({ id: command.clientMessageId, session_id: 'master', role: 'human', content: command.content, timestamp, status: 'completed' }))
    messages.master.push(normalizeMessage({ id: replyId, session_id: 'master', role: 'agent', content: '', timestamp, started_at: new Date(Date.parse(timestamp) - 1).toISOString(), status: 'running' }))
    appendEvent('master', command.clientMessageId, 'message.user', { content: command.content }, false)
    appendEvent('master', replyId, 'lifecycle.prompt_received', {}, false)
  }
  return { commandId: command.commandId, status: 'accepted', duplicate: false }
}

function progress(sessionId: string): void {
  if (!replies[sessionId]) {
    replies[sessionId] = 'member-reply'
    messages[sessionId].push(normalizeMessage({ id: replies[sessionId], session_id: sessionId, role: 'agent', content: '', timestamp: new Date().toISOString(), status: 'running' }))
    appendEvent(sessionId, replies[sessionId], 'lifecycle.prompt_received')
  }
  appendEvent(sessionId, replies[sessionId], 'tool.call', { toolCall: { id: `tool-${replies[sessionId]}`, title: '读取体检报告', status: 'in_progress' } })
}
function complete(notify = true): void {
  const id = replies.master
  const row = messages.master.find(message => message.id === id)!
  const completedAt = new Date().toISOString()
  Object.assign(row, { content: `Master 已完成 ${id}`, status: 'completed', completed_at: completedAt, timestamp: completedAt })
  appendEvent('master', id, 'message.chunk', { role: 'agent', contentDelta: row.content }, notify)
  appendEvent('master', id, 'message.done', { stopReason: 'end_turn' }, notify)
  if (notify) emit('session:done', { sessionId: 'master', messageId: id })
}
const root = createRoot(document.getElementById('root')!)
function mount(id = 'conversation'): void {
  root.render(<TeamChatPane team={{ id: 'team', project_id: 'project', name: '团队恢复验证', description: null, status: 'active', created_at: '', updated_at: '', archived_at: null }} conversation={{ id, team_id: 'team', master_session_id: 'master', title: '体检会话' }} masterSessionId="master" />)
}
Object.assign(window, { teamProbe: {
  progress, complete, mount,
  gap: (): void => emit('resync_required', { sessionId: 'master' }),
  oldDone: (): void => emit('session:done', { sessionId: 'master', messageId: 'reply-1' }),
  recoveryCount: (): number => recoveryCount,
  messagePageCount: (): number => messagePageCount,
} })
mount()
