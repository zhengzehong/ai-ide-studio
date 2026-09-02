import { describe, expect, it } from 'vitest'
import { createChunkRecoveryPolicy, isChunkLoadError } from '../../ui/src/services/chunk-recovery'

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('lazy chunk recovery', () => {
  it('reloads once for a dynamic import failure and then stops', () => {
    const storage = createStorage()
    const policy = createChunkRecoveryPolicy(storage)
    const error = new TypeError('Failed to fetch dynamically imported module')

    expect(policy.shouldReload(error, '/reading')).toBe(true)
    expect(policy.shouldReload(error, '/reading')).toBe(false)
    expect(policy.shouldReload(error, '/settings')).toBe(true)
  })

  it('only classifies module loading failures as chunk errors', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new Error('Loading chunk 12 failed'))).toBe(true)
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
  })
})
