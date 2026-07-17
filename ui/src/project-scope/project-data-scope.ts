import { useAgentStore } from '../stores/agent.store'
import { useSessionStore } from '../stores/session.store'
import { useTaskStore } from '../stores/task.store'

export async function activateProjectData(projectId: string): Promise<void> {
  const taskStore = useTaskStore.getState()
  const agentStore = useAgentStore.getState()
  const sessionStore = useSessionStore.getState()

  taskStore.activateProject(projectId)
  agentStore.activateProject(projectId)
  sessionStore.activateProject(projectId)

  await Promise.all([
    taskStore.fetchTasks(projectId),
    taskStore.fetchModes(projectId),
    agentStore.fetchAgents(projectId),
    sessionStore.fetchSessions(undefined, projectId),
  ])
}

export function invalidateProjectData(projectId: string): void {
  useTaskStore.getState().invalidateProject(projectId)
  useAgentStore.getState().invalidateProject(projectId)
  useSessionStore.getState().invalidateProject(projectId)
}

export function clearProjectData(projectId: string): void {
  useTaskStore.getState().clearProjectCache(projectId)
  useAgentStore.getState().clearProjectCache(projectId)
  useSessionStore.getState().clearProjectCache(projectId)
}
