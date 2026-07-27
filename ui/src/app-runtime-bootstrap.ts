import { invalidateProjectData, refreshProjectData } from './project-scope/project-data-scope'
import { wsClient } from './services/ws-client'
import { useAgentStore } from './stores/agent.store'
import { useKnowledgeBaseStore } from './stores/knowledge-base.store'
import { useModelStore } from './stores/model.store'
import { useProjectSessionStatsStore } from './stores/project-session-stats.store'
import { useProjectStore } from './stores/project.store'
import { useRuleStore } from './stores/rule.store'
import { useSessionStore } from './stores/session.store'
import { useSkillStore } from './stores/skill.store'
import { useTaskStore } from './stores/task.store'
import { useTeamStore } from './stores/team.store'
import { useTemplateStore } from './stores/template.store'
import { useTimelineStore } from './stores/timeline.store'
import { useToolStore } from './stores/tool.store'

export function refreshConnectedAppRuntime(isReconnect: boolean): void {
  if (isReconnect) void recoverRealtimeReconnect()

  useRuleStore.getState().fetchRules()
  useProjectStore.getState().fetchProjects()
  void useProjectSessionStatsStore.getState().fetchStats({ force: isReconnect })
  useTemplateStore.getState().fetchTemplates()
  useToolStore.getState().fetchTools()
  useToolStore.getState().fetchProfiles()
  useModelStore.getState().fetchProviders()
  useSkillStore.getState().fetchSkills()
}

export async function recoverRealtimeReconnect(): Promise<void> {
  const projectId = useProjectStore.getState().currentProjectId
  const sessionId = useSessionStore.getState().currentSessionId
  if (projectId) {
    invalidateProjectData(projectId)
    await refreshProjectData(projectId, { force: true })
  }
  if (useProjectStore.getState().currentProjectId !== projectId) return
  if (!sessionId || useSessionStore.getState().currentSessionId !== sessionId) return
  await recoverCurrentSession(sessionId)
}

export function startAppRuntimeListeners(): () => void {
  const unsubscribers = [
    useAgentStore.getState().setupListeners(),
    useSessionStore.getState().setupListeners(),
    useTaskStore.getState().setupListeners(),
    useRuleStore.getState().setupListeners(),
    useTeamStore.getState().setupListeners(() => useSessionStore.getState().currentSessionId),
    useTimelineStore.getState().setupListeners(),
    useKnowledgeBaseStore.getState().setupListeners(),
    useProjectSessionStatsStore.getState().setupListeners(),
    wsClient.on('reconnected', () => { refreshConnectedAppRuntime(true) }),
    wsClient.on('resync_required', (message) => { void recoverRealtimeGap(message) }),
  ]
  wsClient.setEventListenersReady(true)
  return () => {
    wsClient.setEventListenersReady(false)
    unsubscribers.forEach((unsubscribe) => unsubscribe())
  }
}

export async function recoverRealtimeGap(message: Record<string, unknown>): Promise<void> {
  const sessionStore = useSessionStore.getState()
  const resyncSessionId = typeof message.sessionId === 'string' ? message.sessionId : undefined
  const sessionId = resyncSessionId ?? sessionStore.currentSessionId ?? undefined
  if (sessionId && sessionId === sessionStore.currentSessionId) {
    await recoverCurrentSession(sessionId)
  }
  const projectId = sessionId
    ? findSessionProjectId(sessionStore, sessionId)
    : useProjectStore.getState().currentProjectId
  if (projectId) {
    invalidateProjectData(projectId)
    await Promise.allSettled([refreshProjectData(projectId, { force: true })])
  }
  wsClient.acknowledgeResync(resyncSessionId)
}

async function recoverCurrentSession(sessionId: string): Promise<void> {
  const sessionStore = useSessionStore.getState()
  await Promise.allSettled([
    sessionStore.fetchMessages(sessionId),
    sessionStore.fetchRecovery(sessionId),
  ])
}

function findSessionProjectId(
  state: Pick<ReturnType<typeof useSessionStore.getState>, 'sessions' | 'sessionListCache'>,
  sessionId: string,
): string | undefined {
  const activeSession = state.sessions.find((session) => session.id === sessionId)
  if (activeSession?.project_id) return activeSession.project_id
  for (const entry of Object.values(state.sessionListCache.entries)) {
    const cachedSession = entry.data.find((session) => session.id === sessionId)
    if (cachedSession?.project_id) return cachedSession.project_id
  }
  return undefined
}
