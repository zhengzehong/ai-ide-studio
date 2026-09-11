import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import '../src/index.css'
import SessionListPage from '../src/pages/SessionListPage'
import { ActivityPage } from '../src/pages/ActivityPage'
import { PinnedSessionsPage } from '../src/pages/PinnedSessionsPage'
import { MobileTeamChatSurface } from '../src/components/chat/MobileTeamChatSurface'
import { useAppStore } from '../src/stores/app.store'
import { useSessionStore } from '../src/stores/session.store'
import { usePinnedSessionStore } from '../src/stores/pinned-session.store'
import { useConversationCatalog } from '../src/stores/conversation-catalog.store'
import { useConnectionStore } from '../src/stores/connection.store'
import { useMobileActivityStore } from '../src/stores/activity.store'
import { createEmptyTurn } from '../../ui/src/stores/turn-blocks'
import { normalizeMessage } from '../../ui/src/stores/session-events'
import type { ConversationAdapter } from '../../ui/src/components/chat/conversation-types'
import { wsClient } from '../../ui/src/services/ws-client'
import { ConversationRoute } from '../src/pages/ConversationRoute'
import { installTeamRpcFixture } from './team-rpc-fixture'

const catalog = {
  teams: [{ id: 'team-a', name: '代码审查团队', projectId: 'project' }],
  conversations: [
    { id: 'conversation-a', teamId: 'team-a', projectId: 'project', masterSessionId: 'master-a', title: '登录问题修复', status: 'active', running: true, unread: true, createdAt: '2026-09-11T12:00:00Z', lastMessageAt: '2026-09-11T13:00:00Z', sessionIds: ['master-a', 'worker'] },
    { id: 'conversation-b', teamId: 'team-a', projectId: 'project', masterSessionId: 'master-b', title: '发布回归检查', status: 'active', running: false, unread: false, createdAt: '2026-09-11T12:00:00Z', lastMessageAt: null, sessionIds: ['master-b'] },
  ],
  hiddenAgentIds: ['internal'], hiddenSessionIds: ['master-a', 'master-b', 'worker'],
}
const empty = async (): Promise<void> => {}
useAppStore.setState({ currentProjectId: 'project', agents: [{ id: 'agent', name: 'Claude Code' }, { id: 'internal', name: '内部成员不可见' }], projects: [{ id: 'project', name: '示例项目' }], fetchAgents: empty, fetchProjects: empty })
useSessionStore.setState({ sessions: [{ id: 'ordinary', agentId: 'agent', agentName: 'Claude Code', projectId: 'project', projectName: '示例项目', taskId: null, sessionTitle: '普通会话', status: 'active', activityState: 'running', stage: '', unread: true, startedAt: '2026-09-11T12:00:00Z', updatedAt: null, lastMessageAt: null, lastReadAt: null, closedAt: null }], fetchSessions: empty })
useConversationCatalog.setState({ catalog, loaded: true, load: empty })
useConnectionStore.setState({ connected: true })
useMobileActivityStore.setState({ loaded: true, load: empty })
usePinnedSessionStore.setState({ loaded: true, load: empty, items: [{ sessionId: 'master-a', agentId: 'internal', agentName: 'Master', projectId: 'project', projectName: '示例项目', projectColor: null, projectIcon: null, sessionTitle: null, stage: '', activityState: 'idle', unread: false, lastActivityAt: '', sortOrder: 1, addedAt: '' }] })
wsClient.request = async () => []
installTeamRpcFixture()

function ChatFixture() {
  const [done, setDone] = useState(false)
  const assignment = { content: '检查登录接口的输入校验。\n验证 Token 过期处理。\n核对刷新流程。\n补充测试和报告。', fromName: 'Master' }
  const completed = normalizeMessage({ id: 'worker:reply', session_id: 'master-a', role: 'agent', content: '检查完成，登录接口已覆盖过期场景。', sender_name: '李白', timestamp: '2026-09-11T13:00:00Z', status: 'completed', teamAssignment: assignment })
  const adapter: ConversationAdapter = {
    sessionId: 'master-a', projectId: 'project', agentName: '代码审查团队', sessionTitle: '登录问题修复',
    messages: [normalizeMessage({ id: 'user', session_id: 'master-a', role: 'human', content: '请检查登录问题', timestamp: '2026-09-11T12:00:00Z' }), ...(done ? [completed] : [])],
    streamingMessage: null, streamingMessages: done ? [] : [{ ...createEmptyTurn('worker:reply'), senderName: '李白', teamAssignment: assignment, content: '正在检查登录接口。', finalAnswer: '正在检查登录接口。' }],
    loading: false, error: null, running: !done, sending: false, hasMoreMessages: false, loadingOlderMessages: false,
    pendingPermissions: [], pendingElicitations: [], interactionError: null, usage: null,
    capabilities: { models: [], modes: [], configOptions: [], commands: [], currentModelId: null, currentModeId: null, supportsImages: true },
    sendPrompt: empty, cancel: empty, loadOlderMessages: empty, loadMessageProcess: empty, loadFileChanges: empty, loadProcessItemDetail: empty, respondPermission: empty, respondElicitation: empty,
  }
  return <><button id="complete-fixture" onClick={() => setDone(true)} style={{ position: 'fixed', top: 0, right: 0, zIndex: 50, opacity: 0.01 }}>完成测试</button><MobileTeamChatSurface adapter={adapter} /></>
}

const root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!)
if (import.meta.hot) import.meta.hot.data.root = root
root.render(<BrowserRouter><Routes>
  <Route path="/activity" element={<ActivityPage />} />
  <Route path="/pinned" element={<PinnedSessionsPage />} />
  <Route path="/chat/:sessionId" element={<ConversationRoute />} />
  <Route path="/surface/:id" element={<ChatFixture />} />
  <Route path="*" element={<SessionListPage />} />
</Routes></BrowserRouter>)
