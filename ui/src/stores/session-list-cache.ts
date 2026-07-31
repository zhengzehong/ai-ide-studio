import {
  ALL_PROJECTS_SCOPE,
  clearProjectCache,
  invalidateProjectCache,
  patchCachedArrays,
  projectScopeKey,
  removeCachedArrayItem,
  upsertCachedArrayItem,
  type ProjectCacheState,
} from './project-cache'

export interface ProjectSessionListItem {
  id: string
  agent_id: string
  project_id?: string | null
  // 模板会话(is_template=1)是 ACP fork 出来的上下文镜像,只供模板管理使用,
  // 不应出现在普通会话列表。后端 listSessions 的 SQL 已带 is_template = 0 过滤,
  // 但 session:changed 广播会把模板会话推给前端,这里兜底过滤保持口径一致。
  is_template?: number | boolean
}

const AGENT_SCOPE_SEPARATOR = '::agent:'

export function sessionListScope(projectId?: string | null, agentId?: string): string {
  const projectScope = projectScopeKey(projectId)
  return agentId ? `${projectScope}${AGENT_SCOPE_SEPARATOR}${agentId}` : projectScope
}

export function mergeSessionIntoListCache<T extends ProjectSessionListItem>(
  cache: ProjectCacheState<T[]>,
  session: T,
): ProjectCacheState<T[]> {
  // 模板会话不进列表缓存,与后端 listSessions 的 is_template = 0 过滤口径一致。
  if (session.is_template) return cache
  let next = patchCachedArrays(cache, session.id, session)
  const projectScope = projectScopeKey(session.project_id)
  next = upsertCachedArrayItem(next, projectScope, session)
  next = upsertCachedArrayItem(next, ALL_PROJECTS_SCOPE, session)
  next = upsertCachedArrayItem(next, sessionListScope(session.project_id, session.agent_id), session)
  next = upsertCachedArrayItem(next, sessionListScope(null, session.agent_id), session)
  return next
}

export function removeSessionFromListCache<T extends ProjectSessionListItem>(
  cache: ProjectCacheState<T[]>,
  sessionId: string,
): ProjectCacheState<T[]> {
  return removeCachedArrayItem(cache, sessionId)
}

export function patchSessionInListCache<T extends ProjectSessionListItem>(
  cache: ProjectCacheState<T[]>,
  sessionId: string,
  patch: Partial<T>,
): ProjectCacheState<T[]> {
  return patchCachedArrays(cache, sessionId, patch)
}

export function reorderSessionsInListCache<T extends ProjectSessionListItem>(
  cache: ProjectCacheState<T[]>,
  ordered: T[],
): ProjectCacheState<T[]> {
  const orderedIds = new Set(ordered.map((session) => session.id))
  let changed = false
  const entries = Object.fromEntries(Object.entries(cache.entries).map(([scope, entry]) => {
    if (!entry.data.some((session) => orderedIds.has(session.id))) return [scope, entry]
    changed = true
    return [scope, {
      ...entry,
      data: [...entry.data.filter((session) => !orderedIds.has(session.id)), ...ordered],
    }]
  }))
  return changed ? { ...cache, entries } : cache
}

export function invalidateSessionProjectCache<T>(
  cache: ProjectCacheState<T>,
  projectId?: string | null,
): ProjectCacheState<T> {
  const projectScope = projectScopeKey(projectId)
  return Object.keys(cache.entries)
    .filter((scope) => scope === projectScope || scope.startsWith(`${projectScope}${AGENT_SCOPE_SEPARATOR}`))
    .reduce((next, scope) => invalidateProjectCache(next, scope), cache)
}

export function clearSessionProjectCache<T>(
  cache: ProjectCacheState<T>,
  projectId: string,
): ProjectCacheState<T> {
  return [
    ...Object.keys(cache.entries),
    ...Object.keys(cache.requestSeqByScope),
  ]
    .filter((scope, index, scopes) => (
      scopes.indexOf(scope) === index
      && (scope === projectId || scope.startsWith(`${projectId}${AGENT_SCOPE_SEPARATOR}`))
    ))
    .reduce((next, scope) => clearProjectCache(next, scope), cache)
}
