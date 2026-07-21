import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BOOTSTRAP_SNAPSHOT_VERSION,
  buildBootstrapSnapshot,
  hydrateBootstrapSnapshot,
  parseBootstrapSnapshot,
  registerBootstrapSnapshotPersistence,
  type BootstrapSnapshot,
  type BootstrapStateBridge,
  type BootstrapStateSource,
} from '../../ui/src/project-scope/bootstrap-snapshot.ts'
import type { BootstrapSnapshotStorage } from '../../ui/src/services/bootstrap-snapshot-storage.ts'
import type { ProjectCacheState } from '../../ui/src/stores/project-cache.ts'

afterEach(() => vi.useRealTimers())

describe('bootstrap snapshot coordinator', () => {
  it('keeps the active plus four most recent project caches and removes deleted scopes', () => {
    const source = sourceState()
    source.projects = source.projects.filter((project) => project.id !== 'project-deleted')

    const snapshot = buildBootstrapSnapshot(source, 10_000)

    expect(snapshot.version).toBe(BOOTSTRAP_SNAPSHOT_VERSION)
    expect(snapshot.savedAt).toBe(10_000)
    expect(Object.keys(snapshot.taskCache.entries).sort()).toEqual([
      '__all__',
      'project-2',
      'project-3',
      'project-4',
      'project-5',
      'project-6',
    ])
    expect(snapshot.taskCache.entries['project-1']).toBeUndefined()
    expect(snapshot.taskCache.entries['project-deleted']).toBeUndefined()
  })

  it('hydrates valid snapshots as stale and resets request sequences before network revalidation', async () => {
    const snapshot = buildBootstrapSnapshot(sourceState(), 10_000)
    const storage = storageWith(snapshot)
    let hydrated: BootstrapSnapshot | undefined
    const bridge = bridgeFor(sourceState(), (value) => { hydrated = value })

    await expect(hydrateBootstrapSnapshot(storage, { bridge, timeoutMs: 100 })).resolves.toBe(true)

    expect(hydrated?.currentProjectId).toBe('project-6')
    expect(hydrated?.taskCache.requestSeqByScope).toEqual({})
    expect(hydrated?.agentCache.requestSeqByScope).toEqual({})
    expect(hydrated?.sessionListCache.requestSeqByScope).toEqual({})
    expect(Object.values(hydrated?.taskCache.entries ?? {}).every((entry) => (
      entry.invalidated && entry.fetchedAt === 0 && entry.error === null
    ))).toBe(true)
  })

  it('ignores corrupt, unknown-version, and late snapshots', async () => {
    expect(parseBootstrapSnapshot({ version: 999 })).toBeNull()
    expect(parseBootstrapSnapshot({ version: BOOTSTRAP_SNAPSHOT_VERSION, projects: 'bad' })).toBeNull()

    const lateStorage: BootstrapSnapshotStorage = {
      read: () => new Promise((resolve) => setTimeout(() => resolve(
        buildBootstrapSnapshot(sourceState(), 10_000),
      ), 30)),
      write: async () => true,
      clear: async () => undefined,
    }
    const hydrate = vi.fn()
    const bridge = bridgeFor(sourceState(), hydrate)

    await expect(hydrateBootstrapSnapshot(lateStorage, { bridge, timeoutMs: 5 })).resolves.toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(hydrate).not.toHaveBeenCalled()
  })

  it('debounces multi-store updates into one bounded snapshot write', async () => {
    vi.useFakeTimers()
    const source = sourceState()
    const listeners = new Set<() => void>()
    const bridge: BootstrapStateBridge = {
      read: () => source,
      hydrate: () => undefined,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
    const storage = storageWith(null)
    const stop = registerBootstrapSnapshotPersistence(storage, { bridge, debounceMs: 50 })

    listeners.forEach((listener) => listener())
    listeners.forEach((listener) => listener())
    await vi.advanceTimersByTimeAsync(49)
    expect(storage.write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(storage.write).toHaveBeenCalledTimes(1)
    expect(storage.write).toHaveBeenCalledWith(expect.objectContaining({
      version: BOOTSTRAP_SNAPSHOT_VERSION,
      currentProjectId: 'project-6',
    }))

    stop()
    expect(listeners.size).toBe(0)
  })
})

function sourceState(): BootstrapStateSource {
  const projectIds = Array.from({ length: 6 }, (_, index) => `project-${index + 1}`)
  return {
    projects: [
      ...projectIds.map((id) => project(id)),
      project('project-deleted'),
    ],
    currentProjectId: 'project-6',
    taskCache: cache([...projectIds, 'project-deleted'], 'task'),
    agentCache: cache([...projectIds, 'project-deleted'], 'agent'),
    sessionListCache: cache([...projectIds, 'project-deleted'], 'session'),
    activeSession: {
      sessionId: 'session-project-6',
      messages: [{ id: 'message-1', session_id: 'session-project-6', role: 'human', content: 'hello' }],
    },
  }
}

function cache(scopes: string[], prefix: string): ProjectCacheState<Array<{ id: string }>> {
  const entries = Object.fromEntries(scopes.map((scope, index) => [scope, {
    data: [{ id: `${prefix}-${scope}` }],
    fetchedAt: index + 1,
    lastAccessedAt: index + 1,
    invalidated: false,
    error: index === 0 ? 'old error' : null,
  }]))
  entries.__all__ = {
    data: [],
    fetchedAt: 1,
    lastAccessedAt: 1,
    invalidated: false,
    error: null,
  }
  return { entries, requestSeqByScope: { 'project-6': 9 } }
}

function project(id: string) {
  return {
    id,
    name: id,
    work_dir: `C:/${id}`,
    description: null,
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-20T00:00:00.000Z',
    color: null,
    icon: null,
    last_visited_at: null,
    visit_count: 0,
  }
}

function bridgeFor(
  source: BootstrapStateSource,
  hydrate: (snapshot: BootstrapSnapshot) => void,
): BootstrapStateBridge {
  return { read: () => source, hydrate, subscribe: () => () => undefined }
}

function storageWith(value: unknown): BootstrapSnapshotStorage & { write: ReturnType<typeof vi.fn> } {
  return {
    read: async () => value,
    write: vi.fn(async () => true),
    clear: async () => undefined,
  }
}
