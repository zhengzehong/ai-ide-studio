import { useCallback, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useWorkspaceSessionRestore, useWorkspaceSessionVisibility } from '../../ui/src/pages/workspace/use-workspace-session-restore'
import { useSessionStore, writeProjectLastSession, type SessionData } from '../../ui/src/stores/session.store'
import type { AgentData } from '../../ui/src/stores/agent.store'
import { emit, requests } from './workspace-selection-ws'

const sessions = ['a', 'b'].map((id) => ({ id: `session-${id}`, agent_id: `agent-${id}`, project_id: `project-${id}`,
  last_message_at: '2026-09-13T06:20:00.000Z',
} as SessionData))
const agents = ['a', 'b'].map((id) => ({ id: `agent-${id}` } as AgentData))
writeProjectLastSession('project-a', 'session-a')
writeProjectLastSession('project-b', 'session-b')
useSessionStore.setState({ sessions })
useSessionStore.getState().setupListeners()

function Fixture(): ReactElement {
  const [projectId, setProjectId] = useState('project-a')
  const [selectedTeamId, setTeam] = useState<string | null>(null)
  const [selectedAgentId, setAgent] = useState<string | null>('default-agent')
  const [fileMode, setFileMode] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const currentSessionId = useSessionStore((state) => state.currentSessionId)
  const unread = useSessionStore((state) => !!state.unreadSessionIds['session-a'])
  const onRestore = useCallback((session: SessionData): void => {
    setAgent(session.agent_id)
    useSessionStore.getState().selectSession(session.id)
  }, [])
  const dismiss = useWorkspaceSessionRestore({ projectId, selectedTeamId, currentSessionId,
    hasExplicitTarget: false, loading: false, agents, sessions: sessions.filter((s) => s.project_id === projectId), onRestore,
  })
  useWorkspaceSessionVisibility(!selectedTeamId && !fileMode ? currentSessionId : null)
  return <>
    <output id="state">{JSON.stringify({ projectId, selectedTeamId, selectedAgentId, currentSessionId, unread, refresh })}</output>
    <button id="team" onClick={() => { dismiss(); setTeam('team'); setAgent(null); useSessionStore.getState().selectSession(null) }}>Team</button>
    <button id="refresh" onClick={() => setRefresh((value) => value + 1)}>Refresh</button>
    <button id="done" onClick={() => emit('session:done', { sessionId: 'session-a', stopReason: 'end_turn' })}>Done</button>
    <button id="ordinary" onClick={() => { dismiss(); setTeam(null); onRestore(sessions[0]) }}>Ordinary</button>
    <button id="empty-agent" onClick={() => { dismiss(); setTeam(null); setAgent('empty'); useSessionStore.getState().selectSession(null) }}>Empty Agent</button>
    <button id="file" onClick={() => setFileMode((value) => !value)}>File</button>
    <button id="project" onClick={() => { setProjectId('project-b'); setTeam(null); useSessionStore.getState().selectSession(null) }}>Project B</button>
    <button id="unread" onClick={async () => { await useSessionStore.getState().markUnread('session-a'); useSessionStore.getState().selectSession(null) }}>Unread</button>
  </>
}

const root = createRoot(document.getElementById('root')!)
Object.assign(window, {
  readRequests: (): Record<string, unknown>[] => requests.filter((request) => request.type === 'sessions.markRead'),
  unmountFixture: (): void => root.unmount(),
  completeHidden: (): void => emit('session:done', { sessionId: 'session-a', stopReason: 'end_turn' }),
  isUnread: (): boolean => !!useSessionStore.getState().unreadSessionIds['session-a'],
})
root.render(<Fixture />)
