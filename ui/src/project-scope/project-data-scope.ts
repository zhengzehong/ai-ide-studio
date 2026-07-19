import { useAgentStore } from '../stores/agent.store'
import { useAgentMemoryStore } from '../stores/agent-memory.store'
import { useEventCenterStore } from '../stores/event-center.store'
import { useFileSystemStore } from '../stores/filesystem.store'
import { useKnowledgeBaseStore } from '../stores/knowledge-base.store'
import { useProjectViewStateStore } from '../stores/project-view-state.store'
import { useRuleStore } from '../stores/rule.store'
import { clearProjectLastSession, useSessionStore } from '../stores/session.store'
import { useTaskStore } from '../stores/task.store'

const knownProjectIds = new Set<string>()
const projectActivations = new Map<string, Promise<void>>()

export function activateProjectData(projectId: string): Promise<void> {
  const currentActivation = projectActivations.get(projectId)
  if (currentActivation) return currentActivation

  knownProjectIds.add(projectId)
  const taskStore = useTaskStore.getState()
  const agentStore = useAgentStore.getState()
  const sessionStore = useSessionStore.getState()

  taskStore.activateProject(projectId)
  agentStore.activateProject(projectId)
  sessionStore.activateProject(projectId)
  useFileSystemStore.getState().activateProject(projectId)
  useKnowledgeBaseStore.getState().activateProject(projectId)
  useRuleStore.getState().activateProject(projectId)
  useEventCenterStore.getState().activateProject(projectId)
  useAgentMemoryStore.getState().activateScope(projectId)

  const activation = refreshProjectData(projectId).finally(() => {
    if (projectActivations.get(projectId) === activation) projectActivations.delete(projectId)
  })
  projectActivations.set(projectId, activation)
  return activation
}

export async function refreshProjectData(
  projectId: string,
  options?: { force?: boolean },
): Promise<void> {
  const forceOptions = options?.force ? { force: true } : undefined
  await Promise.allSettled([
    forceOptions
      ? useTaskStore.getState().fetchTasks(projectId, forceOptions)
      : useTaskStore.getState().fetchTasks(projectId),
    useTaskStore.getState().fetchModes(projectId),
    forceOptions
      ? useAgentStore.getState().fetchAgents(projectId, forceOptions)
      : useAgentStore.getState().fetchAgents(projectId),
    forceOptions
      ? useSessionStore.getState().fetchSessions(undefined, projectId, forceOptions)
      : useSessionStore.getState().fetchSessions(undefined, projectId),
    forceOptions
      ? useFileSystemStore.getState().fetchTree(projectId, forceOptions)
      : useFileSystemStore.getState().fetchTree(projectId),
    forceOptions
      ? useKnowledgeBaseStore.getState().fetchKnowledgeBases(projectId, forceOptions)
      : useKnowledgeBaseStore.getState().fetchKnowledgeBases(projectId),
    forceOptions
      ? useRuleStore.getState().fetchRules(projectId, forceOptions)
      : useRuleStore.getState().fetchRules(projectId),
    useEventCenterStore.getState().fetchCategories(projectId),
    forceOptions
      ? useEventCenterStore.getState().fetchEvents(projectId, {}, forceOptions)
      : useEventCenterStore.getState().fetchEvents(projectId),
    useEventCenterStore.getState().fetchSubscriptions(projectId),
  ])
}

export function invalidateProjectData(projectId: string): void {
  useTaskStore.getState().invalidateProject(projectId)
  useAgentStore.getState().invalidateProject(projectId)
  useSessionStore.getState().invalidateProject(projectId)
  useFileSystemStore.getState().invalidateProject(projectId)
  useKnowledgeBaseStore.getState().invalidateProject(projectId)
  useRuleStore.getState().invalidateProject(projectId)
  useEventCenterStore.getState().invalidateProject(projectId)
  useAgentMemoryStore.getState().invalidateProject(projectId)
}

export function clearProjectData(projectId: string): void {
  knownProjectIds.delete(projectId)
  projectActivations.delete(projectId)
  useTaskStore.getState().clearProjectCache(projectId)
  useAgentStore.getState().clearProjectCache(projectId)
  useSessionStore.getState().clearProjectCache(projectId)
  useFileSystemStore.getState().clearProjectCache(projectId)
  useKnowledgeBaseStore.getState().clearProjectCache(projectId)
  useRuleStore.getState().clearProjectCache(projectId)
  useEventCenterStore.getState().clearProjectCache(projectId)
  useAgentMemoryStore.getState().clearProjectCache(projectId)
  useProjectViewStateStore.getState().clearProject(projectId)
  clearProjectLastSession(projectId)
}

export function reconcileProjectData(validProjectIds: string[]): void {
  const valid = new Set(validProjectIds)
  for (const projectId of knownProjectIds) {
    if (!valid.has(projectId)) clearProjectData(projectId)
  }
  useProjectViewStateStore.getState().reconcileProjects(validProjectIds)
}
