export const PROJECT_LOCATION_STORAGE_KEY = 'ai-ide-project-last-locations-v1'

export const PROJECT_ROUTE_PATHS = [
  '/workspace',
  '/tasks',
  '/tasks/modes',
  '/schedule',
  '/events',
  '/knowledge',
  '/agent-memory',
] as const

export interface ProjectLocation {
  pathname: string
  search: string
  hash: string
}

interface StoredProjectLocation extends ProjectLocation {
  updatedAt: number
}

type StoredProjectLocations = Record<string, StoredProjectLocation>

export const DEFAULT_PROJECT_LOCATION: ProjectLocation = {
  pathname: '/workspace',
  search: '',
  hash: '',
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function normalizeSuffix(value: string, prefix: '?' | '#'): string {
  if (!value) return ''
  return value.startsWith(prefix) ? value : `${prefix}${value}`
}

function readStoredLocations(storage: Storage | null): StoredProjectLocations {
  if (!storage) return {}
  try {
    const raw = storage.getItem(PROJECT_LOCATION_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as StoredProjectLocations
  } catch {
    return {}
  }
}

function writeStoredLocations(storage: Storage | null, locations: StoredProjectLocations): void {
  if (!storage) return
  try {
    storage.setItem(PROJECT_LOCATION_STORAGE_KEY, JSON.stringify(locations))
  } catch {
    // Route memory is best-effort when storage is unavailable or full.
  }
}

export function isProjectPath(pathname: string): boolean {
  const normalized = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname
  return PROJECT_ROUTE_PATHS.some((path) => normalized === path)
}

export function normalizeProjectLocation(location: ProjectLocation): ProjectLocation {
  const pathname = location.pathname.length > 1 && location.pathname.endsWith('/')
    ? location.pathname.slice(0, -1)
    : location.pathname
  if (!isProjectPath(pathname)) return { ...DEFAULT_PROJECT_LOCATION }
  return {
    pathname,
    search: normalizeSuffix(location.search, '?'),
    hash: normalizeSuffix(location.hash, '#'),
  }
}

export function stripProjectPrefix(pathname: string, projectId: string): string {
  const prefix = `/p/${encodeURIComponent(projectId)}`
  if (pathname === prefix || pathname === `${prefix}/`) return DEFAULT_PROJECT_LOCATION.pathname
  if (!pathname.startsWith(`${prefix}/`)) return DEFAULT_PROJECT_LOCATION.pathname
  return normalizeProjectLocation({
    pathname: pathname.slice(prefix.length),
    search: '',
    hash: '',
  }).pathname
}

export function buildProjectPath(projectId: string, location: ProjectLocation | null): string {
  const normalized = normalizeProjectLocation(location ?? DEFAULT_PROJECT_LOCATION)
  return `/p/${encodeURIComponent(projectId)}${normalized.pathname}${normalized.search}${normalized.hash}`
}

export function readLastProjectLocation(
  projectId: string,
  storage: Storage | null = browserStorage(),
): ProjectLocation {
  const stored = readStoredLocations(storage)[projectId]
  if (!stored || typeof stored.pathname !== 'string') return { ...DEFAULT_PROJECT_LOCATION }
  return normalizeProjectLocation({
    pathname: stored.pathname,
    search: typeof stored.search === 'string' ? stored.search : '',
    hash: typeof stored.hash === 'string' ? stored.hash : '',
  })
}

export function rememberProjectLocation(
  projectId: string,
  location: ProjectLocation,
  storage: Storage | null = browserStorage(),
): void {
  if (!projectId) return
  const locations = readStoredLocations(storage)
  locations[projectId] = {
    ...normalizeProjectLocation(location),
    updatedAt: Date.now(),
  }
  writeStoredLocations(storage, locations)
}

export function removeProjectLocation(
  projectId: string,
  storage: Storage | null = browserStorage(),
): void {
  const locations = readStoredLocations(storage)
  if (!(projectId in locations)) return
  delete locations[projectId]
  writeStoredLocations(storage, locations)
}
