import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { AgentData } from '../../stores/agent.store'
import {
  clearProjectLastSession, clearStoredSessionId, readProjectLastSession, readStoredSessionId,
  useSessionStore, type SessionData,
} from '../../stores/session.store'
import { canRestoreProjectSession } from './helpers'

interface RestoreInput {
  projectId: string | null
  currentSessionId: string | null
  selectedTeamId: string | null
  hasExplicitTarget: boolean
  loading: boolean
  sessions: SessionData[]
  agents: AgentData[]
  onRestore: (session: SessionData) => void
}

export function useWorkspaceSessionRestore({
  projectId, currentSessionId, selectedTeamId, hasExplicitTarget, loading, sessions, agents, onRestore,
}: RestoreInput): () => void {
  const entry = useRef<{ projectId: string | null; settled: boolean }>({ projectId: null, settled: false })
  const dismissRestore = useCallback((): void => {
    entry.current = { projectId, settled: true }
  }, [projectId])

  useEffect(() => {
    if (entry.current.projectId !== projectId) entry.current = { projectId, settled: false }
    if (!projectId || entry.current.settled) return
    if (selectedTeamId || sessions.some((session) => session.id === currentSessionId)) {
      entry.current.settled = true
      return
    }
    if (hasExplicitTarget || currentSessionId || loading || sessions.length === 0) return
    // Restore once per project entry, never after an intentional deselection.
    entry.current.settled = true
    const storedId = readProjectLastSession(projectId)
    if (!storedId) return
    const session = sessions.find((item) => item.id === storedId)
    const agent = agents.find((item) => item.id === session?.agent_id)
    if (!session || !canRestoreProjectSession(session, agent)) {
      clearProjectLastSession(projectId)
      if (readStoredSessionId() === storedId) clearStoredSessionId()
      return
    }
    onRestore(session)
  }, [projectId, currentSessionId, selectedTeamId, hasExplicitTarget, loading, sessions, agents, onRestore])

  return dismissRestore
}

export function useWorkspaceSessionVisibility(sessionId: string | null): void {
  useLayoutEffect(() => {
    useSessionStore.getState().setVisibleSessionId(sessionId)
    return () => { useSessionStore.getState().setVisibleSessionId(null) }
  }, [sessionId])
}
