import { useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ConversationMessageList } from '../../ui/src/components/chat/ConversationMessageList'
import type { ConversationAdapter } from '../../ui/src/components/chat/conversation-types'
import { aggregateSnapshots, applyEventToSnapshot, emptySnapshot, type Snapshot } from '../../ui/src/components/team/team-chat-state'
import { beginTeamPrompt, rejectTeamPrompt } from '../../ui/src/components/team/team-chat-pending'
import { defaultCaps, type SessionEventData } from '../../ui/src/stores/session-events'

const noop = async (): Promise<void> => undefined
let sequence = 0
function App(): ReactElement {
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({})
  const [shown, setShown] = useState(true)
  const send = (): void => setSnapshots(current => ({ ...current, master: beginTeamPrompt(current.master || emptySnapshot('master'), { id: 'master:h1', session_id: 'master', role: 'human', content: '你好', timestamp: new Date().toISOString(), thinking: null, tool_calls_json: null, decision_json: null }) }))
  const emit = (type: string, payload: Record<string, unknown>, sessionId = 'master'): void => {
    const event: SessionEventData = { id: `e${++sequence}`, sequence, type, session_id: sessionId, message_id: 'm1', created_at: new Date().toISOString(), payload_json: JSON.stringify({ messageId: 'm1', ...payload }) }
    setSnapshots(current => applyEventToSnapshot(current, sessionId, event, 'master'))
  }
  const aggregate = aggregateSnapshots(snapshots, ['master', 'member'], 'master')
  const adapter: ConversationAdapter = {
    sessionId: 'master', agentName: 'Master', messages: aggregate.messages, events: [], streamingMessage: aggregate.streaming[0] || null, streamingMessages: aggregate.streaming,
    loading: false, error: null, running: aggregate.running, sending: false, connected: true, hasMoreMessages: false, loadingOlderMessages: false,
    pendingPermissions: [], pendingElicitations: [], interactionError: null, capabilities: defaultCaps, usage: null,
    sendPrompt: async () => send(), cancel: noop, loadOlderMessages: noop, loadMessageProcess: noop, loadFileChanges: noop, loadProcessItemDetail: noop, respondPermission: noop, respondElicitation: noop,
  }
  return <>
    <nav>
      <button onClick={send}>发送</button>
      <button onClick={() => emit('lifecycle.accepted', {})}>隐藏阶段</button>
      <button onClick={() => emit('lifecycle.prompt_sent', { content: '正在思考...' })}>准备</button>
      <button onClick={() => emit('thinking.chunk', { thinking: '正在检查项目' })}>思考</button>
      <button onClick={() => emit('message.chunk', { role: 'agent', contentDelta: '回复内容' })}>回复</button>
      <button onClick={() => emit('message.chunk', { role: 'agent', contentDelta: '成员回复' }, 'member')}>成员</button>
      <button onClick={() => emit('message.done', { turnUsage: { inputTokens: 12000, outputTokens: 350, cachedReadTokens: 4000, costAmount: 0.01 } })}>完成</button>
      <button onClick={() => emit('message.done', { stopReason: 'cancelled' })}>取消</button>
      <button onClick={() => setSnapshots(current => ({ ...current, master: rejectTeamPrompt(current.master, 'master:h1') }))}>拒绝</button>
      <button onClick={() => setShown(value => !value)}>切换</button>
      <button onClick={() => setSnapshots({})}>清空</button>
    </nav>
    <main style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 65px)' }}>{shown && <ConversationMessageList adapter={adapter} />}</main>
  </>
}
createRoot(document.getElementById('root')!).render(<App />)
