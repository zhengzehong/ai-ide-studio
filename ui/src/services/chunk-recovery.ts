export interface ChunkRecoveryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface ChunkRecoveryPolicy {
  shouldReload(error: unknown, pathname: string): boolean
  clear(pathname: string): void
}

const RELOAD_KEY = 'ai-ide-chunk-reload-path'

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /failed to fetch dynamically imported module|error loading dynamically imported module|loading chunk|module script|chunkloaderror/i.test(message)
}

export function createChunkRecoveryPolicy(storage: ChunkRecoveryStorage): ChunkRecoveryPolicy {
  return {
    shouldReload(error: unknown, pathname: string): boolean {
      if (!isChunkLoadError(error)) return false
      try {
        if (storage.getItem(RELOAD_KEY) === pathname) return false
        storage.setItem(RELOAD_KEY, pathname)
        return true
      } catch {
        return false
      }
    },
    clear(pathname: string): void {
      try {
        if (storage.getItem(RELOAD_KEY) === pathname) storage.removeItem(RELOAD_KEY)
      } catch {
        // Storage can be unavailable in restricted renderer contexts.
      }
    },
  }
}

export function getChunkRecoveryStorage(): ChunkRecoveryStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}
