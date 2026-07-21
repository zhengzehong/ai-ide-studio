import { useAgentStore, type AgentData } from '../stores/agent.store'
import {
  ALL_PROJECTS_SCOPE,
  readProjectCache,
  type ProjectCacheState,
} from '../stores/project-cache'
import { useProjectStore } from '../stores/project.store'
import {
  exportSessionMessagesBootstrapSnapshot,
  hydrateSessionMessagesBootstrapSnapshot,
  useSessionStore,
  type SessionData,
  type SessionMessagesBootstrapSnapshot,
} from '../stores/session.store'
import { useTaskStore, type TaskData } from '../stores/task.store'
import type {
  ActiveSessionBootstrapSnapshot,
  BootstrapSnapshot,
  BootstrapStateBridge,
  BootstrapStateSource,
} from './bootstrap-snapshot'

export function createZustandBootstrapBridge(): BootstrapStateBridge {
  return {
    read: readZustandBootstrapState,
    hydrate: hydrateZustandBootstrapState,
    subscribe(listener) {
      const unsubscribers = [
        useProjectStore.subscribe(listener),
        useTaskStore.subscribe(listener),
        useAgentStore.subscribe(listener),
        useSessionStore.subscribe(listener),
      ]
      return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
    },
  }
}

function readZustandBootstrapState(): BootstrapStateSource {
  const projects = useProjectStore.getState()
  return {
    projects: projects.projects,
    currentProjectId: projects.currentProjectId,
    taskCache: useTaskStore.getState().taskCache,
    agentCache: useAgentStore.getState().agentCache,
    sessionListCache: useSessionStore.getState().sessionListCache,
    activeSession: exportSessionMessagesBootstrapSnapshot(),
  }
}

function hydrateZustandBootstrapState(snapshot: BootstrapSnapshot): void {
  const currentProjectId = snapshot.currentProjectId
    && snapshot.projects.some((project) => project.id === snapshot.currentProjectId)
    ? snapshot.currentProjectId
    : snapshot.projects[0]?.id ?? null
  const activeScope = currentProjectId ?? ALL_PROJECTS_SCOPE
  const taskCache = snapshot.taskCache as ProjectCacheState<TaskData[]>
  const agentCache = snapshot.agentCache as ProjectCacheState<AgentData[]>
  const sessionListCache = snapshot.sessionListCache as ProjectCacheState<SessionData[]>

  useProjectStore.setState({
    projects: snapshot.projects,
    currentProjectId,
    previousProjectId: null,
    loading: false,
    initialized: true,
  })
  useTaskStore.setState({
    taskCache,
    activeScope,
    tasks: readProjectCache(taskCache, activeScope)?.data ?? [],
    loading: false,
    refreshing: false,
  })
  useAgentStore.setState({
    agentCache,
    activeScope,
    agents: readProjectCache(agentCache, activeScope)?.data ?? [],
    loading: false,
    refreshing: false,
  })
  useSessionStore.setState({
    sessionListCache,
    activeSessionScope: activeScope,
    sessions: readProjectCache(sessionListCache, activeScope)?.data ?? [],
    loading: false,
    refreshing: false,
  })
  hydrateSessionMessagesBootstrapSnapshot(toSessionSnapshot(snapshot.activeSession))
}

function toSessionSnapshot(
  snapshot: ActiveSessionBootstrapSnapshot | null,
): SessionMessagesBootstrapSnapshot | null {
  if (!snapshot) return null
  return {
    sessionId: snapshot.sessionId,
    messages: snapshot.messages as SessionMessagesBootstrapSnapshot['messages'],
  }
}
