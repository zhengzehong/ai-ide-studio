import { describe, expect, it, vi } from 'vitest'
import {
  BOOTSTRAP_SNAPSHOT_MAX_BYTES,
  createIndexedDbBootstrapStorage,
  type BootstrapSnapshotDatabase,
} from '../../ui/src/services/bootstrap-snapshot-storage.ts'

describe('IndexedDB bootstrap snapshot storage', () => {
  it('replaces, reads, and clears the single current snapshot record', async () => {
    const database = new MemorySnapshotDatabase()
    const storage = createIndexedDbBootstrapStorage({
      openDatabase: async () => database,
    })

    await expect(storage.read()).resolves.toBeNull()
    await expect(storage.write({ version: 1, projects: ['a'] })).resolves.toBe(true)
    await expect(storage.write({ version: 1, projects: ['b'] })).resolves.toBe(true)
    await expect(storage.read()).resolves.toEqual({ version: 1, projects: ['b'] })
    await storage.clear()
    await expect(storage.read()).resolves.toBeNull()
  })

  it('rejects snapshots above the serialized size ceiling without touching IndexedDB', async () => {
    const database = new MemorySnapshotDatabase()
    const storage = createIndexedDbBootstrapStorage({
      openDatabase: async () => database,
    })

    await expect(storage.write({ payload: 'x'.repeat(BOOTSTRAP_SNAPSHOT_MAX_BYTES) }))
      .resolves.toBe(false)
    expect(database.putCalls).toBe(0)
  })

  it('treats unavailable or private-mode IndexedDB as a cache miss and reports once', async () => {
    const onError = vi.fn()
    const storage = createIndexedDbBootstrapStorage({
      openDatabase: async () => { throw new Error('IndexedDB disabled') },
      onError,
    })

    await expect(storage.read()).resolves.toBeNull()
    await expect(storage.write({ version: 1 })).resolves.toBe(false)
    await expect(storage.clear()).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
  })

  it('ignores corrupt serialized records instead of blocking startup', async () => {
    const database = new MemorySnapshotDatabase()
    database.value = '{not-json'
    const onError = vi.fn()
    const storage = createIndexedDbBootstrapStorage({
      openDatabase: async () => database,
      onError,
    })

    await expect(storage.read()).resolves.toBeNull()
    expect(onError).toHaveBeenCalledTimes(1)
  })
})

class MemorySnapshotDatabase implements BootstrapSnapshotDatabase {
  value: string | undefined
  putCalls = 0

  async get(): Promise<string | undefined> {
    return this.value
  }

  async put(value: string): Promise<void> {
    this.putCalls += 1
    this.value = value
  }

  async delete(): Promise<void> {
    this.value = undefined
  }
}
