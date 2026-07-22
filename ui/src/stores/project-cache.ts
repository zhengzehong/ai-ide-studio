export const ALL_PROJECTS_SCOPE = '__all__'
export const PROJECT_CACHE_TTL_MS = 30_000
export const MAX_PROJECT_CACHE_ENTRIES = 5

export interface ProjectCacheEntry<T> {
  data: T
  fetchedAt: number
  lastAccessedAt: number
  invalidated: boolean
  error: string | null
}

export interface ProjectCacheState<T> {
  entries: Record<string, ProjectCacheEntry<T>>
  requestSeqByScope: Record<string, number>
  errorsByScope?: Record<string, string>
}

export interface BeginRequestResult<T> {
  state: ProjectCacheState<T>
  requestSeq: number
}

export interface CommitInput<T> {
  scope: string
  requestSeq: number
  data: T
  now?: number
}

export function emptyProjectCache<T>(): ProjectCacheState<T> {
  return { entries: {}, requestSeqByScope: {}, errorsByScope: {} }
}

export function projectScopeKey(projectId?: string | null): string {
  return projectId || ALL_PROJECTS_SCOPE
}

export function readProjectCache<T>(
  state: ProjectCacheState<T>,
  scope: string,
): ProjectCacheEntry<T> | null {
  return state.entries[scope] ?? null
}

export function shouldRefreshProjectCache<T>(
  entry: ProjectCacheEntry<T> | null,
  now = Date.now(),
): boolean {
  return !entry || entry.invalidated || now - entry.fetchedAt > PROJECT_CACHE_TTL_MS
}

export function beginProjectRequest<T>(
  state: ProjectCacheState<T>,
  scope: string,
): BeginRequestResult<T> {
  const requestSeq = (state.requestSeqByScope[scope] ?? 0) + 1
  const errorsByScope = { ...state.errorsByScope }
  delete errorsByScope[scope]
  return {
    state: {
      ...state,
      requestSeqByScope: { ...state.requestSeqByScope, [scope]: requestSeq },
      errorsByScope,
    },
    requestSeq,
  }
}

export function canCommitProjectResponse<T>(
  state: ProjectCacheState<T>,
  scope: string,
  requestSeq: number,
): boolean {
  return state.requestSeqByScope[scope] === requestSeq
}

export function commitProjectResponse<T>(
  state: ProjectCacheState<T>,
  input: CommitInput<T>,
): ProjectCacheState<T> {
  if (!canCommitProjectResponse(state, input.scope, input.requestSeq)) return state
  const now = input.now ?? Date.now()
  const errorsByScope = { ...state.errorsByScope }
  delete errorsByScope[input.scope]
  return {
    ...state,
    errorsByScope,
    entries: {
      ...state.entries,
      [input.scope]: {
        data: input.data,
        fetchedAt: now,
        lastAccessedAt: now,
        invalidated: false,
        error: null,
      },
    },
  }
}

export function touchProjectCache<T>(
  state: ProjectCacheState<T>,
  scope: string,
  now = Date.now(),
): ProjectCacheState<T> {
  const entry = state.entries[scope]
  if (!entry) return state
  return {
    ...state,
    entries: {
      ...state.entries,
      [scope]: { ...entry, lastAccessedAt: now },
    },
  }
}

export function invalidateProjectCache<T>(
  state: ProjectCacheState<T>,
  scope: string,
): ProjectCacheState<T> {
  const entry = state.entries[scope]
  if (!entry || entry.invalidated) return state
  return {
    ...state,
    entries: { ...state.entries, [scope]: { ...entry, invalidated: true } },
  }
}

export function setProjectCacheError<T>(
  state: ProjectCacheState<T>,
  scope: string,
  error: string,
): ProjectCacheState<T> {
  const entry = state.entries[scope]
  return {
    ...state,
    entries: entry
      ? { ...state.entries, [scope]: { ...entry, error } }
      : state.entries,
    errorsByScope: { ...state.errorsByScope, [scope]: error },
  }
}

export function readProjectCacheError<T>(
  state: ProjectCacheState<T>,
  scope: string,
): string | null {
  return state.errorsByScope?.[scope] ?? state.entries[scope]?.error ?? null
}

export function clearProjectCache<T>(
  state: ProjectCacheState<T>,
  scope: string,
): ProjectCacheState<T> {
  if (!(scope in state.entries) && !(scope in state.requestSeqByScope)) return state
  const entries = { ...state.entries }
  const requestSeqByScope = { ...state.requestSeqByScope }
  const errorsByScope = { ...state.errorsByScope }
  delete entries[scope]
  delete requestSeqByScope[scope]
  delete errorsByScope[scope]
  return { entries, requestSeqByScope, errorsByScope }
}

function evictProjectCacheEntry<T>(
  state: ProjectCacheState<T>,
  scope: string,
): ProjectCacheState<T> {
  if (!(scope in state.entries) && !(scope in (state.errorsByScope ?? {}))) return state
  const entries = { ...state.entries }
  const errorsByScope = { ...state.errorsByScope }
  delete entries[scope]
  delete errorsByScope[scope]
  return { ...state, entries, errorsByScope }
}

export function patchCachedArrays<T extends { id: string }>(
  state: ProjectCacheState<T[]>,
  id: string,
  patch: Partial<T>,
): ProjectCacheState<T[]> {
  let changed = false
  const entries = Object.fromEntries(Object.entries(state.entries).map(([scope, entry]) => {
    if (!entry.data.some((item) => item.id === id)) return [scope, entry]
    changed = true
    return [scope, {
      ...entry,
      data: entry.data.map((item) => item.id === id ? { ...item, ...patch } : item),
    }]
  }))
  return changed ? { ...state, entries } : state
}

export function upsertCachedArrayItem<T extends { id: string }>(
  state: ProjectCacheState<T[]>,
  scope: string,
  incoming: T,
  now = Date.now(),
): ProjectCacheState<T[]> {
  const entry = state.entries[scope]
  if (!entry) return state
  const existing = entry.data.some((item) => item.id === incoming.id)
  const data = existing
    ? entry.data.map((item) => item.id === incoming.id ? { ...item, ...incoming } : item)
    : [incoming, ...entry.data]
  return {
    ...state,
    entries: {
      ...state.entries,
      [scope]: { ...entry, data, lastAccessedAt: now },
    },
  }
}

export function removeCachedArrayItem<T extends { id: string }>(
  state: ProjectCacheState<T[]>,
  id: string,
): ProjectCacheState<T[]> {
  let changed = false
  const entries = Object.fromEntries(Object.entries(state.entries).map(([scope, entry]) => {
    if (!entry.data.some((item) => item.id === id)) return [scope, entry]
    changed = true
    return [scope, { ...entry, data: entry.data.filter((item) => item.id !== id) }]
  }))
  return changed ? { ...state, entries } : state
}

export function pruneProjectCache<T>(
  state: ProjectCacheState<T>,
  activeScope: string,
  maxEntries = MAX_PROJECT_CACHE_ENTRIES,
): ProjectCacheState<T> {
  const projectEntries = Object.entries(state.entries)
    .filter(([scope]) => scope !== ALL_PROJECTS_SCOPE && scope !== activeScope)
    .sort(([, left], [, right]) => left.lastAccessedAt - right.lastAccessedAt)
  const projectCount = Object.keys(state.entries)
    .filter((scope) => scope !== ALL_PROJECTS_SCOPE).length
  const removeCount = Math.max(0, projectCount - maxEntries)
  if (removeCount === 0) return state
  return projectEntries.slice(0, removeCount)
    .reduce((next, [scope]) => evictProjectCacheEntry(next, scope), state)
}
