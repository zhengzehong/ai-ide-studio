import { wsClient } from '../../ui/src/services/ws-client'
import { normalizeMessage, type MessageData } from '../../ui/src/stores/session-events'

type Listener = (value: Record<string, unknown>) => void
const handlers = new Map<string, Set<Listener>>()
const history: Record<string, MessageData[]> = {
  'master-a': [normalizeMessage({ id: 'user1', session_id: 'master-a', role: 'human', content: '检查登录', timestamp: '2026-09-11T12:00:00Z' })],
  worker: [normalizeMessage({ id: 'reply1', session_id: 'worker', role: 'agent', content: '成员历史已加载', status: 'completed', timestamp: '2026-09-11T12:01:00Z' })],
}
let sequence = 0
const commands: { type: string; sessionId: string }[] = []
const requests: Record<string, unknown>[] = []
const resyncAcks: (string | undefined)[] = []
let recoveryFails = false
const emit = (type: string, message: Record<string, unknown>): void => { handlers.get(type)?.forEach(handler => handler(message)) }

export function installTeamRpcFixture(): void {
  wsClient.subscribe = () => undefined
  wsClient.unsubscribe = () => undefined
  wsClient.acknowledgeResync = sessionId => { resyncAcks.push(sessionId) }
  wsClient.on = (type, handler) => {
    const listeners = handlers.get(type) ?? new Set<Listener>()
    listeners.add(handler)
    handlers.set(type, listeners)
    return () => { listeners.delete(handler) }
  }
  wsClient.request = async message => {
    requests.push(message)
    if (message.type === 'sessions.messages') return history[String(message.sessionId)] ?? []
    if (message.type === 'sessions.events') {
      if (recoveryFails && message.sessionId === 'worker') throw new Error('模拟断线恢复失败')
      return sequence ? [{ id: 'boundary', session_id: message.sessionId, type: 'session.status', sequence, payload_json: '{}', created_at: new Date().toISOString() }] : []
    }
    if (message.type === 'team.conversation.history') return { members: [
      { id: 'leader', agent_id: 'internal', session_id: 'master-a', name: 'Master', role: 'leader' },
      { id: 'member', agent_id: 'worker-agent', session_id: 'worker', name: '李白', role: 'member' },
    ] }
    if (message.type === 'team.conversation.create') return { conversation: { master_session_id: 'master-a' } }
    if (message.type === 'session.getModels') return { models: [], modes: [], configOptions: [], commands: [], currentModelId: null, currentModeId: null, supportsImages: true }
    return []
  }
  wsClient.send = command => {
    const sessionId = String(command.sessionId)
    commands.push({ type: String(command.type), sessionId })
    if (command.type === 'prompt') {
      const user = normalizeMessage({ id: String(command.clientMessageId), session_id: sessionId, role: 'human', content: String(command.content), timestamp: new Date().toISOString() })
      history[sessionId] = [...history[sessionId] ?? [], user]
      emit('session:event', { sessionId: 'worker', event: { id: 'fixture-chunk', session_id: 'worker', message_id: 'reply2', type: 'message.chunk', sequence: ++sequence, created_at: new Date().toISOString(), payload_json: JSON.stringify({ role: 'agent', messageId: 'reply2', contentDelta: '成员正在流式输出' }) } })
    }
  }
  Object.assign(window, {
    teamRpcFixture: {
      commands,
      requests,
      resyncAcks,
      resync: (fail: boolean): void => { recoveryFails = fail; emit('resync_required', { sessionId: 'worker' }) },
      complete: (): void => {
        const message = normalizeMessage({ id: 'reply2', session_id: 'worker', role: 'agent', content: '成员最终结果保持可见', status: 'completed', timestamp: new Date().toISOString(), completed_at: new Date().toISOString() })
        history.worker = [...history.worker, message]
        emit('session:done', { sessionId: 'worker', messageId: 'reply2', stopReason: 'end_turn' })
      },
    },
  })
}
