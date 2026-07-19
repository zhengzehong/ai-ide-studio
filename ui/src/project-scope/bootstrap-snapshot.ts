import type { BootstrapSnapshotStorage } from '../services/bootstrap-snapshot-storage'
import type { ProjectData } from '../stores/project.store'
import {
  ALL_PROJECTS_SCOPE,
  MAX_PROJECT_CACHE_ENTRIES,
  type ProjectCacheEntry,
  type ProjectCacheState,
} from '../stores/project-cache'

export const BOOTSTRAP_SNAPSHOT_VERSION = 1

export interface ActiveSessionBootstrapSnapshot {
  sessionId: string
  messages: unknown[]
}

export interface BootstrapStateSource {
  projects: ProjectData[]
  currentProjectId: string | null
  taskCache: ProjectCacheState<unknown[]>
  agentCache: ProjectCacheState<unknown[]>
  sessionListCache: ProjectCacheState<unknown[]>
  activeSession: ActiveSessionBootstrapSnapshot | null
}

export interface BootstrapSnapshot extends BootstrapStateSource {
  version: typeof BOOTSTRAP_SNAPSHOT_VERSION
  savedAt: number
}

export interface BootstrapStateBridge {
  read(): BootstrapStateSource
  hydrate(snapshot: BootstrapSnapshot): void
  subscribe(listener: () => void): () => void
}

export interface HydrateBootstrapOptions {
  bridge: BootstrapStateBridge
  timeoutMs?: number
}

export interface PersistBootstrapOptions {
  bridge: BootstrapStateBridge
  debounceMs?: number
}

export function buildBootstrapSnapshot(
  source: BootstrapStateSource,
  now = Date.now(),
): BootstrapSnapshot {
  const validProjectIds = new Set(source.projects.map((project) => project.id))
  const retained = retainedProjectIds(source, validProjectIds)
  return {
    version: BOOTSTRAP_SNAPSHOT_VERSION,
    savedAt: now,
    projects: clone(source.projects),
    currentProjectId: source.currentProjectId && validProjectIds.has(source.currentProjectId)
      ? source.currentProjectId
      : null,
    taskCache: retainCache(source.taskCache, retained),
    agentCache: retainCache(source.agentCache, retained),
    sessionListCache: retainCache(source.sessionListCache, retained),
    activeSession: source.activeSession ? clone(source.activeSession) : null,
  }
}

export function parseBootstrapSnapshot(value: unknown): BootstrapSnapshot | null {
  if (!isRecord(value)
    || value.version !== BOOTSTRAP_SNAPSHOT_VERSION
    || !Number.isFinite(value.savedAt)
    || !Array.isArray(value.projects)
    || !(value.currentProjectId === null || typeof value.currentProjectId === 'string')
    || !isProjectCacheState(value.taskCache)
    || !isProjectCacheState(value.agentCache)
    || !isProjectCacheState(value.sessionListCache)
    || !isActiveSession(value.activeSession)) {
    return null
  }
  if (!value.projects.every(isProjectData)) return null
  return value as unknown as BootstrapSnapshot
}

export async function hydrateBootstrapSnapshot(
  storage: BootstrapSnapshotStorage,
  options: HydrateBootstrapOptions,
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 100
  const timeout = Symbol('bootstrap-timeout')
  const value = await Promise.race([
    storage.read(),
    new Promise<typeof timeout>((resolve) => setTimeout(() => resolve(timeout), timeoutMs)),
  ])
  if (value === timeout) return false
  const parsed = parseBootstrapSnapshot(value)
  if (!parsed) return false
  options.bridge.hydrate(staleSnapshot(parsed))
  return true
}

export function registerBootstrapSnapshotPersistence(
  storage: BootstrapSnapshotStorage,
  options: PersistBootstrapOptions,
): () => void {
  const debounceMs = options.debounceMs ?? 500
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const schedule = (): void => {
    if (stopped) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      if (!stopped) void storage.write(buildBootstrapSnapshot(options.bridge.read()))
    }, debounceMs)
  }
  const unsubscribe = options.bridge.subscribe(schedule)
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    timer = undefined
    unsubscribe()
  }
}

function retainedProjectIds(
  source: BootstrapStateSource,
  validProjectIds: Set<string>,
): Set<string> {
  const scores = new Map<string, number>()
  for (const cache of [source.taskCache, source.agentCache, source.sessionListCache]) {
    for (const [scope, entry] of Object.entries(cache.entries)) {
      if (scope !== ALL_PROJECTS_SCOPE && validProjectIds.has(scope)) {
        scores.set(scope, Math.max(scores.get(scope) ?? 0, entry.lastAccessedAt))
      }
    }
  }
  const ordered = [...validProjectIds].sort((left, right) => {
    if (left === source.currentProjectId) return -1
    if (right === source.currentProjectId) return 1
    return (scores.get(right) ?? 0) - (scores.get(left) ?? 0)
  })
  return new Set(ordered.slice(0, MAX_PROJECT_CACHE_ENTRIES))
}

function retainCache<T>(
  cache: ProjectCacheState<T>,
  retained: Set<string>,
): ProjectCacheState<T> {
  const entries = Object.fromEntries(Object.entries(cache.entries)
    .filter(([scope]) => scope === ALL_PROJECTS_SCOPE || retained.has(scope))
    .map(([scope, entry]) => [scope, clone(entry)]))
  const requestSeqByScope = Object.fromEntries(Object.entries(cache.requestSeqByScope)
    .filter(([scope]) => scope === ALL_PROJECTS_SCOPE || retained.has(scope)))
  return { entries, requestSeqByScope }
}

function staleSnapshot(snapshot: BootstrapSnapshot): BootstrapSnapshot {
  return {
    ...clone(snapshot),
    taskCache: staleCache(snapshot.taskCache),
    agentCache: staleCache(snapshot.agentCache),
    sessionListCache: staleCache(snapshot.sessionListCache),
  }
}

function staleCache<T>(cache: ProjectCacheState<T>): ProjectCacheState<T> {
  const entries = Object.fromEntries(Object.entries(cache.entries).map(([scope, entry]) => [scope, {
    ...clone(entry),
    fetchedAt: 0,
    invalidated: true,
    error: null,
  }]))
  return { entries, requestSeqByScope: {} }
}

function isProjectCacheState(value: unknown): value is ProjectCacheState<unknown[]> {
  if (!isRecord(value) || !isRecord(value.entries) || !isRecord(value.requestSeqByScope)) return false
  return Object.values(value.entries).every(isProjectCacheEntry)
    && Object.values(value.requestSeqByScope).every((sequence) => Number.isInteger(sequence))
}

function isProjectCacheEntry(value: unknown): value is ProjectCacheEntry<unknown[]> {
  return isRecord(value)
    && Array.isArray(value.data)
    && Number.isFinite(value.fetchedAt)
    && Number.isFinite(value.lastAccessedAt)
    && typeof value.invalidated === 'boolean'
    && (value.error === null || typeof value.error === 'string')
}

function isActiveSession(value: unknown): value is ActiveSessionBootstrapSnapshot | null {
  return value === null || (isRecord(value)
    && typeof value.sessionId === 'string'
    && Array.isArray(value.messages))
}

function isProjectData(value: unknown): value is ProjectData {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.work_dir === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clone<T>(value: T): T {
  return structuredClone(value)
}
