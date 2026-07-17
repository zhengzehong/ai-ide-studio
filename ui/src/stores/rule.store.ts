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
  shouldRefreshProjectCache,
  touchProjectCache,
  upsertCachedArrayItem,
  type ProjectCacheState,
} from './project-cache'

export interface RuleData {
  id: string
  name: string
  description: string | null
  cron: string
  action: string
  action_config: Record<string, unknown>
  enabled: boolean
  last_run_at: string | null
  last_fail_at: string | null
  next_run_at: string | null
  run_count: number
  fail_count: number
  max_runs: number | null
  created_by: string | null
  trigger_type: string
  created_at: string
  updated_at: string
  project_id: string | null
}

export interface RuleExecution {
  id: string
  rule_id: string
  status: 'success' | 'failed' | 'skipped'
  task_id: string | null
  session_id: string | null
  error: string | null
  triggered_at: string
  completed_at: string | null
}

interface RuleStore {
  rules: RuleData[]
  loading: boolean
  refreshing: boolean
  activeScope: string
  ruleCache: ProjectCacheState<RuleData[]>
  activateProject: (projectId?: string | null) => void
  fetchRules: (projectId?: string, options?: { force?: boolean }) => Promise<void>
  invalidateProject: (projectId?: string | null) => void
  clearProjectCache: (projectId: string) => void
  createRule: (input: {
    name: string
    cron: string
    action: string
    actionConfig: Record<string, unknown>
    description?: string
    projectId?: string
    maxRuns?: number
  }) => Promise<RuleData>
  updateRule: (ruleId: string, fields: Record<string, unknown>) => Promise<RuleData | null>
  toggleRule: (ruleId: string, enabled: boolean) => Promise<void>
  deleteRule: (ruleId: string) => Promise<void>
  runNow: (ruleId: string) => Promise<void>
  fetchExecutions: (ruleId: string, limit?: number) => Promise<RuleExecution[]>
  setupListeners: () => () => void
}

const ruleFetches = new Map<string, Promise<void>>()

function mergeRuleIntoCache(
  cache: ProjectCacheState<RuleData[]>,
  rule: RuleData,
): ProjectCacheState<RuleData[]> {
  let next = patchCachedArrays(cache, rule.id, rule)
  if (rule.project_id) next = upsertCachedArrayItem(next, rule.project_id, rule)
  next = upsertCachedArrayItem(next, ALL_PROJECTS_SCOPE, rule)
  return next
}

export const useRuleStore = create<RuleStore>((set, get) => ({
  rules: [],
  loading: false,
  refreshing: false,
  activeScope: ALL_PROJECTS_SCOPE,
  ruleCache: emptyProjectCache<RuleData[]>(),

  activateProject: (projectId) => {
    const scope = projectScopeKey(projectId)
    set((state) => {
      const ruleCache = pruneProjectCache(touchProjectCache(state.ruleCache, scope), scope)
      return {
        activeScope: scope,
        ruleCache,
        rules: readProjectCache(ruleCache, scope)?.data ?? [],
        loading: false,
        refreshing: false,
      }
    })
  },

  fetchRules: async (projectId, options) => {
    const scope = projectScopeKey(projectId)
    const cached = readProjectCache(get().ruleCache, scope)
    if (!options?.force && cached && !shouldRefreshProjectCache(cached)) return
    const inFlight = ruleFetches.get(scope)
    if (!options?.force && inFlight) return inFlight
    let requestSeq = 0
    set((state) => {
      const request = beginProjectRequest(state.ruleCache, scope)
      requestSeq = request.requestSeq
      const isActive = state.activeScope === scope
      return {
        ruleCache: request.state,
        loading: isActive && !cached,
        refreshing: isActive && !!cached,
      }
    })
    const request = (async (): Promise<void> => {
      try {
      const msg: Record<string, unknown> = { type: 'rules.list' }
      if (projectId) msg.projectId = projectId
      const data = await wsClient.request(msg) as RuleData[]
        set((state) => {
          const ruleCache = pruneProjectCache(commitProjectResponse(state.ruleCache, {
            scope,
            requestSeq,
            data,
          }), state.activeScope)
          const isActive = state.activeScope === scope
          return {
            ruleCache,
            rules: isActive ? (readProjectCache(ruleCache, scope)?.data ?? []) : state.rules,
            loading: isActive ? false : state.loading,
            refreshing: isActive ? false : state.refreshing,
          }
        })
      } catch {
        if (get().activeScope === scope) set({ loading: false, refreshing: false })
      }
    })()
    ruleFetches.set(scope, request)
    try {
      await request
    } finally {
      if (ruleFetches.get(scope) === request) ruleFetches.delete(scope)
    }
  },

  invalidateProject: (projectId) => set((state) => ({
    ruleCache: invalidateProjectCache(state.ruleCache, projectScopeKey(projectId)),
  })),

  clearProjectCache: (projectId) => set((state) => ({
    ruleCache: clearProjectCache(state.ruleCache, projectId),
  })),

  createRule: async (input) => {
    const msg: Record<string, unknown> = {
      type: 'rules.create',
      name: input.name,
      cron: input.cron,
      action: input.action,
      actionConfig: input.actionConfig,
    }
    if (input.description) msg.description = input.description
    if (input.projectId) msg.projectId = input.projectId
    if (input.maxRuns) msg.maxRuns = input.maxRuns
    const rule = await wsClient.request(msg) as RuleData
    set((state) => {
      const ruleCache = mergeRuleIntoCache(state.ruleCache, rule)
      return {
        ruleCache,
        rules: readProjectCache(ruleCache, state.activeScope)?.data ?? [rule, ...state.rules],
      }
    })
    return rule
  },

  updateRule: async (ruleId, fields) => {
    const msg: Record<string, unknown> = { type: 'rules.update', ruleId, ...fields }
    const result = await wsClient.request(msg) as RuleData | null
    if (result) {
      set((state) => {
        const ruleCache = mergeRuleIntoCache(state.ruleCache, result)
        return {
          ruleCache,
          rules: readProjectCache(ruleCache, state.activeScope)?.data
            ?? state.rules.map((rule) => rule.id === ruleId ? { ...rule, ...result } : rule),
        }
      })
    }
    return result
  },

  toggleRule: async (ruleId, enabled) => {
    await wsClient.request({ type: 'rules.toggle', ruleId, enabled })
    set((state) => {
      const ruleCache = patchCachedArrays(state.ruleCache, ruleId, { enabled })
      return {
        ruleCache,
        rules: readProjectCache(ruleCache, state.activeScope)?.data
          ?? state.rules.map((rule) => rule.id === ruleId ? { ...rule, enabled } : rule),
      }
    })
  },

  deleteRule: async (ruleId) => {
    await wsClient.request({ type: 'rules.delete', ruleId })
    set((state) => {
      const ruleCache = removeCachedArrayItem(state.ruleCache, ruleId)
      return {
        ruleCache,
        rules: readProjectCache(ruleCache, state.activeScope)?.data
          ?? state.rules.filter((rule) => rule.id !== ruleId),
      }
    })
  },

  runNow: async (ruleId) => {
    await wsClient.request({ type: 'rules.runNow', ruleId })
  },

  fetchExecutions: async (ruleId, limit = 20) => {
    return await wsClient.request({ type: 'rules.executions', ruleId, limit }) as RuleExecution[]
  },

  setupListeners: () => {
    const off = wsClient.on('rule:update', (msg) => {
      const ruleId = msg.ruleId as string
      const data = msg.data as Record<string, unknown>
      if (data.event === 'deleted') {
        set((state) => {
          const ruleCache = removeCachedArrayItem(state.ruleCache, ruleId)
          return {
            ruleCache,
            rules: readProjectCache(ruleCache, state.activeScope)?.data
              ?? state.rules.filter((rule) => rule.id !== ruleId),
          }
        })
      } else {
        set((state) => {
          const complete = typeof data.id === 'string' && typeof data.name === 'string'
          const ruleCache = complete
            ? mergeRuleIntoCache(state.ruleCache, data as unknown as RuleData)
            : patchCachedArrays(state.ruleCache, ruleId, data as Partial<RuleData>)
          const cached = readProjectCache(ruleCache, state.activeScope)?.data
          const rules = cached ?? (state.rules.some((rule) => rule.id === ruleId)
            ? state.rules.map((rule) => rule.id === ruleId ? { ...rule, ...data } as RuleData : rule)
            : complete ? [data as unknown as RuleData, ...state.rules] : state.rules)
          return { ruleCache, rules }
        })
      }
    })
    return off
  },
}))
