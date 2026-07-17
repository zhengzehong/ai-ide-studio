import { create } from 'zustand'
import { wsClient } from '../services/ws-client'
import {
  ALL_PROJECTS_SCOPE,
  beginProjectRequest,
  clearProjectCache,
  commitProjectResponse,
  emptyProjectCache,
  invalidateProjectCache,
  patchCachedArrays,
  projectScopeKey,
  pruneProjectCache,
  readProjectCache,
  removeCachedArrayItem,
  setProjectCacheError,
  shouldRefreshProjectCache,
  touchProjectCache,
  upsertCachedArrayItem,
  type ProjectCacheState,
} from './project-cache'

export interface AgentData {
  id: string
  type: string
  name: string
  runtime: string
  status: string
  permission_level: number
  config_json: string | null
  created_at: string
  project_id?: string | null
  template_id?: string | null
  system_prompt?: string
  icon?: string
  avatar_url?: string | null
  sort_order?: number | null
  hidden_at?: string | null
}

export interface ProjectAgentInput {
  name: string
  agentType: string
  runtime: string
  systemPrompt?: string
  icon?: string
  avatarUrl?: string | null
  modelProfileId?: string | null
}

interface AgentStore {
  agents: AgentData[]
  loading: boolean
  refreshing: boolean
  activeScope: string
  agentCache: ProjectCacheState<AgentData[]>
  activateProject: (projectId?: string | null) => void
  fetchAgents: (projectId?: string, options?: { force?: boolean }) => Promise<void>
  invalidateProject: (projectId?: string | null) => void
  clearProjectCache: (projectId: string) => void
  createAgent: (name: string, agentType: string, runtime: string) => Promise<AgentData>
  deployTemplate: (projectId: string, templateId: string, input?: Partial<ProjectAgentInput>) => Promise<AgentData>
  createCustomAgent: (projectId: string, input: ProjectAgentInput) => Promise<AgentData>
  updateAgent: (agentId: string, input: Partial<ProjectAgentInput>) => Promise<AgentData>
  deleteAgent: (agentId: string) => Promise<void>
  setAgentHidden: (agentId: string, hidden: boolean) => Promise<AgentData>
  reorderAgents: (projectId: string, agentIds: string[]) => Promise<AgentData[]>
  setupListeners: () => () => void
}

const agentFetches = new Map<string, Promise<void>>()

function mergeAgentIntoCache(
  cache: ProjectCacheState<AgentData[]>,
  agent: AgentData,
): ProjectCacheState<AgentData[]> {
  let next = patchCachedArrays(cache, agent.id, agent)
  if (agent.project_id) next = upsertCachedArrayItem(next, agent.project_id, agent)
  next = upsertCachedArrayItem(next, ALL_PROJECTS_SCOPE, agent)
  return next
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [],
  loading: false,
  refreshing: false,
  activeScope: ALL_PROJECTS_SCOPE,
  agentCache: emptyProjectCache<AgentData[]>(),

  activateProject: (projectId) => {
    const scope = projectScopeKey(projectId)
    set((state) => {
      const agentCache = pruneProjectCache(touchProjectCache(state.agentCache, scope), scope)
      return {
        activeScope: scope,
        agentCache,
        agents: readProjectCache(agentCache, scope)?.data ?? [],
        loading: false,
        refreshing: false,
      }
    })
  },

  fetchAgents: async (projectId, options) => {
    const scope = projectScopeKey(projectId)
    const cached = readProjectCache(get().agentCache, scope)
    if (!options?.force && cached && !shouldRefreshProjectCache(cached)) return
    const inFlight = agentFetches.get(scope)
    if (!options?.force && inFlight) return inFlight

    let requestSeq = 0
    set((state) => {
      const request = beginProjectRequest(state.agentCache, scope)
      requestSeq = request.requestSeq
      const isActive = state.activeScope === scope
      return {
        agentCache: request.state,
        loading: isActive && !cached,
        refreshing: isActive && !!cached,
      }
    })

    const request = (async (): Promise<void> => {
      try {
        const msg: Record<string, unknown> = { type: 'agents.list' }
        if (projectId) msg.projectId = projectId
        const data = await wsClient.request(msg) as AgentData[]
        set((state) => {
          const agentCache = pruneProjectCache(commitProjectResponse(state.agentCache, {
            scope,
            requestSeq,
            data,
          }), state.activeScope)
          const isActive = state.activeScope === scope
          return {
            agentCache,
            agents: isActive ? (readProjectCache(agentCache, scope)?.data ?? []) : state.agents,
            loading: isActive ? false : state.loading,
            refreshing: isActive ? false : state.refreshing,
          }
        })
      } catch (error) {
        set((state) => {
          const isActive = state.activeScope === scope
          return {
            agentCache: setProjectCacheError(
              state.agentCache,
              scope,
              error instanceof Error ? error.message : 'Agent 加载失败',
            ),
            loading: isActive ? false : state.loading,
            refreshing: isActive ? false : state.refreshing,
          }
        })
      }
    })()
    agentFetches.set(scope, request)
    try {
      await request
    } finally {
      if (agentFetches.get(scope) === request) agentFetches.delete(scope)
    }
  },

  invalidateProject: (projectId) => {
    const scope = projectScopeKey(projectId)
    set((state) => ({ agentCache: invalidateProjectCache(state.agentCache, scope) }))
  },

  clearProjectCache: (projectId) => {
    set((state) => ({ agentCache: clearProjectCache(state.agentCache, projectId) }))
  },

  createAgent: async (name, agentType, runtime) => {
    const agent = await wsClient.request({ type: 'agents.create', name, agentType, runtime }) as AgentData
    set((state) => {
      const agentCache = mergeAgentIntoCache(state.agentCache, agent)
      return {
        agentCache,
        agents: readProjectCache(agentCache, state.activeScope)?.data
          ?? [...state.agents.filter((item) => item.id !== agent.id), agent],
      }
    })
    return agent
  },

  deployTemplate: async (projectId, templateId, input = {}) => {
    const agent = await wsClient.request({ type: 'agents.deployTemplate', projectId, templateId, ...input }) as AgentData
    set((state) => {
      const agentCache = mergeAgentIntoCache(state.agentCache, agent)
      return {
        agentCache,
        agents: readProjectCache(agentCache, state.activeScope)?.data
          ?? [...state.agents.filter((item) => item.id !== agent.id), agent],
      }
    })
    return agent
  },

  createCustomAgent: async (projectId, input) => {
    const agent = await wsClient.request({ type: 'agents.createCustom', projectId, ...input }) as AgentData
    set((state) => {
      const agentCache = mergeAgentIntoCache(state.agentCache, agent)
      return {
        agentCache,
        agents: readProjectCache(agentCache, state.activeScope)?.data
          ?? [...state.agents.filter((item) => item.id !== agent.id), agent],
      }
    })
    return agent
  },

  updateAgent: async (agentId, input) => {
    const agent = await wsClient.request({ type: 'agents.update', agentId, ...input }) as AgentData
    set((state) => {
      const agentCache = mergeAgentIntoCache(state.agentCache, agent)
      return {
        agentCache,
        agents: readProjectCache(agentCache, state.activeScope)?.data
          ?? state.agents.map((item) => item.id === agentId ? agent : item),
      }
    })
    return agent
  },

  deleteAgent: async (agentId) => {
    await wsClient.request({ type: 'agents.delete', agentId })
    set((state) => {
      const agentCache = removeCachedArrayItem(state.agentCache, agentId)
      return {
        agentCache,
        agents: readProjectCache(agentCache, state.activeScope)?.data
          ?? state.agents.filter((agent) => agent.id !== agentId),
      }
    })
  },

  setAgentHidden: async (agentId, hidden) => {
    const agent = await wsClient.request({ type: 'agents.setHidden', agentId, hidden }) as AgentData
    set((state) => {
      const agentCache = mergeAgentIntoCache(state.agentCache, agent)
      return {
        agentCache,
        agents: readProjectCache(agentCache, state.activeScope)?.data
          ?? state.agents.map((item) => item.id === agentId ? agent : item),
      }
    })
    return agent
  },

  reorderAgents: async (projectId, agentIds) => {
    const ordered = await wsClient.request({ type: 'agents.reorder', projectId, agentIds }) as AgentData[]
    const orderedIds = new Set(ordered.map((agent) => agent.id))
    set((state) => {
      const agents = [
        ...state.agents.filter((agent) => agent.project_id !== projectId || !orderedIds.has(agent.id)),
        ...ordered,
      ]
      let agentCache = state.agentCache
      for (const agent of ordered) agentCache = mergeAgentIntoCache(agentCache, agent)
      return { agentCache, agents }
    })
    return ordered
  },

  setupListeners: () => {
    const off = wsClient.on('agent:status', (msg) => {
      const agentId = msg.agentId as string
      const status = msg.status as string
      set((state) => {
        const agentCache = patchCachedArrays(state.agentCache, agentId, { status })
        return {
          agentCache,
          agents: readProjectCache(agentCache, state.activeScope)?.data
            ?? state.agents.map((agent) => agent.id === agentId ? { ...agent, status } : agent),
        }
      })
    })
    return off
  },
}))
