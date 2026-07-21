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

export function startConnectedAppRuntime(isReconnect: boolean): () => void {
  const projectId = useProjectStore.getState().currentProjectId
  if (isReconnect && projectId) {
    invalidateProjectData(projectId)
    void refreshProjectData(projectId, { force: true })
  }

  useRuleStore.getState().fetchRules()
  useProjectStore.getState().fetchProjects()
  void useProjectSessionStatsStore.getState().fetchStats({ force: isReconnect })
  useTemplateStore.getState().fetchTemplates()
  useToolStore.getState().fetchTools()
  useToolStore.getState().fetchProfiles()
  useModelStore.getState().fetchProviders()
  useSkillStore.getState().fetchSkills()

  const unsubscribers = [
    useAgentStore.getState().setupListeners(),
    useSessionStore.getState().setupListeners(),
    useTaskStore.getState().setupListeners(),
    useRuleStore.getState().setupListeners(),
    useTeamStore.getState().setupListeners(() => useSessionStore.getState().currentSessionId),
    useTimelineStore.getState().setupListeners(),
    useKnowledgeBaseStore.getState().setupListeners(),
    useProjectSessionStatsStore.getState().setupListeners(),
    wsClient.on('resync_required', handleResyncRequired),
  ]
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
}

function handleResyncRequired(message: Record<string, unknown>): void {
  const sessionStore = useSessionStore.getState()
  const resyncSessionId = typeof message.sessionId === 'string' ? message.sessionId : undefined
  const sessionId = resyncSessionId ?? sessionStore.currentSessionId ?? undefined
  const recovery: Promise<unknown>[] = []
  if (sessionId && sessionId === sessionStore.currentSessionId) {
    recovery.push(sessionStore.fetchMessages(sessionId), sessionStore.fetchEvents(sessionId))
  }
  const activeProjectId = useProjectStore.getState().currentProjectId
  if (activeProjectId) {
    invalidateProjectData(activeProjectId)
    recovery.push(refreshProjectData(activeProjectId, { force: true }))
  }
  void Promise.allSettled(recovery).then(() => wsClient.acknowledgeResync(resyncSessionId))
}
