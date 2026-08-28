export type OperationContext = Record<string, string | number | boolean | null | undefined>

export interface OperationDescriptor {
  operationModule: string
  operation: string
  context?: OperationContext
}

export interface OperationSnapshot extends OperationDescriptor {
  startedAtMs: number
  elapsedMs: number
}

export interface OperationDiagnosticsSnapshot {
  activeOperationCount: number
  activeOperations: OperationSnapshot[]
  recentSyncOperations: OperationSnapshot[]
}

export interface OperationDiagnostics {
  trackAsync<T>(descriptor: OperationDescriptor, execute: () => Promise<T>): Promise<T>
  trackSync<T>(descriptor: OperationDescriptor, execute: () => T): T
  trackSyncInvocation<T>(descriptor: OperationDescriptor, invoke: () => T): T
  snapshot(): OperationDiagnosticsSnapshot
  consumeSnapshot(): OperationDiagnosticsSnapshot
  clear(): void
}

interface CreateOperationDiagnosticsOptions {
  now?: () => number
  maxActiveOperations?: number
  maxRecentOperations?: number
}

interface ActiveOperation extends OperationDescriptor {
  id: number
  startedAtMs: number
}

const DEFAULT_MAX_ACTIVE_OPERATIONS = 10
const DEFAULT_MAX_RECENT_OPERATIONS = 20

export function createOperationDiagnostics(
  options: CreateOperationDiagnosticsOptions = {},
): OperationDiagnostics {
  const now = options.now ?? Date.now
  const maxActiveOperations = options.maxActiveOperations ?? DEFAULT_MAX_ACTIVE_OPERATIONS
  const maxRecentOperations = options.maxRecentOperations ?? DEFAULT_MAX_RECENT_OPERATIONS
  const active = new Map<number, ActiveOperation>()
  const recentSync: OperationSnapshot[] = []
  let nextId = 1

  const trackSync = <T>(descriptor: OperationDescriptor, execute: () => T): T => {
    const startedAtMs = now()
    try {
      return execute()
    } finally {
      const completedAtMs = now()
      recentSync.unshift({
        ...descriptor,
        startedAtMs,
        elapsedMs: Math.max(0, completedAtMs - startedAtMs),
      })
      recentSync.sort((left, right) => right.elapsedMs - left.elapsedMs)
      recentSync.splice(maxRecentOperations)
    }
  }

  return {
    async trackAsync<T>(descriptor: OperationDescriptor, execute: () => Promise<T>): Promise<T> {
      const operation: ActiveOperation = { ...descriptor, id: nextId++, startedAtMs: now() }
      active.set(operation.id, operation)
      try {
        return await execute()
      } finally {
        active.delete(operation.id)
      }
    },
    trackSync,
    trackSyncInvocation: trackSync,
    snapshot(): OperationDiagnosticsSnapshot {
      const sampledAtMs = now()
      return {
        activeOperationCount: active.size,
        activeOperations: [...active.values()]
          .slice(-maxActiveOperations)
          .map(({ id: _id, ...operation }) => ({
            ...operation,
            elapsedMs: Math.max(0, sampledAtMs - operation.startedAtMs),
          })),
        recentSyncOperations: recentSync.map((operation) => ({ ...operation })),
      }
    },
    consumeSnapshot(): OperationDiagnosticsSnapshot {
      const snapshot = this.snapshot()
      recentSync.length = 0
      return snapshot
    },
    clear(): void {
      active.clear()
      recentSync.length = 0
    },
  }
}

export const operationDiagnostics = createOperationDiagnostics()

export function trackAsyncOperation<T>(
  descriptor: OperationDescriptor,
  execute: () => Promise<T>,
): Promise<T> {
  return operationDiagnostics.trackAsync(descriptor, execute)
}

export function trackSyncOperation<T>(descriptor: OperationDescriptor, execute: () => T): T {
  return operationDiagnostics.trackSync(descriptor, execute)
}

export function trackSyncInvocation<T>(descriptor: OperationDescriptor, invoke: () => T): T {
  return operationDiagnostics.trackSyncInvocation(descriptor, invoke)
}

export function operationDiagnosticsContext(): OperationDiagnosticsSnapshot {
  return operationDiagnostics.consumeSnapshot()
}
