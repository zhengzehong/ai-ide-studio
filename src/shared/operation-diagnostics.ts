export type OperationContext = Record<string, string | number | boolean | null | undefined>

export interface OperationDescriptor {
  operationModule: string
  operation: string
  context?: OperationContext
}

export interface OperationSnapshot extends OperationDescriptor {
  startedAtMs: number
  elapsedMs: number
  /**
   * 该次同步调用消耗的 CPU 时间(用户态+内核态)。
   * ioWaitMs = elapsedMs - cpuMs:两者接近说明时间花在等 I/O(磁盘/网络),
   * ioWaitMs≈0 说明是 CPU/GC 忙。用于把"慢"直接归因成 I/O 等待还是计算。
   */
  cpuMs?: number
  ioWaitMs?: number
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
  trackInvocation<T>(descriptor: OperationDescriptor, invoke: () => T | Promise<T>): T | Promise<T>
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
    const cpuStarted = process.cpuUsage()
    try {
      return execute()
    } finally {
      recordSyncCompletion(descriptor, startedAtMs, cpuStarted)
    }
  }

  const recordSyncCompletion = (
    descriptor: OperationDescriptor,
    startedAtMs: number,
    cpuStarted: NodeJS.CpuUsage,
  ): void => {
    const completedAtMs = now()
    const elapsedMs = Math.max(0, completedAtMs - startedAtMs)
    const cpu = process.cpuUsage(cpuStarted)
    const cpuMs = Math.min((cpu.user + cpu.system) / 1000, elapsedMs)
    recentSync.unshift({
      ...descriptor,
      startedAtMs,
      elapsedMs,
      // 同步调用期间的墙钟 vs CPU:差值即 I/O 等待(2026-09-16 卡顿定案埋点)
      cpuMs,
      ioWaitMs: Math.max(0, elapsedMs - cpuMs),
    })
    recentSync.sort((left, right) => right.elapsedMs - left.elapsedMs)
    recentSync.splice(maxRecentOperations)
  }

  /**
   * handler 可能是同步的也可能返回 Promise。同步分支行为与 trackSync 完全一致;
   * 异步分支在 Promise settle 时记一条耗时(P0-1 之前用 trackSync 包 async handler,
   * 只会量到同步前缀 ≈0ms,导致 fs.list 这类操作在 recentSyncOperations 里"消失")。
   * 异步条目不记 cpuMs/ioWaitMs —— 跨 await 的 CPU 时间不属于这一次调用。
   */
  const trackInvocation = <T>(descriptor: OperationDescriptor, invoke: () => T | Promise<T>): T | Promise<T> => {
    const startedAtMs = now()
    const cpuStarted = process.cpuUsage()
    let result: T | Promise<T>
    try {
      result = invoke()
    } catch (error) {
      recordSyncCompletion(descriptor, startedAtMs, cpuStarted)
      throw error
    }
    if (!isThenable(result)) {
      recordSyncCompletion(descriptor, startedAtMs, cpuStarted)
      return result
    }
    const record = (): void => {
      const elapsedMs = Math.max(0, now() - startedAtMs)
      recentSync.unshift({ ...descriptor, startedAtMs, elapsedMs })
      recentSync.sort((left, right) => right.elapsedMs - left.elapsedMs)
      recentSync.splice(maxRecentOperations)
    }
    return Promise.resolve(result).then(
      (value) => { record(); return value },
      (error) => { record(); throw error },
    )
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
    trackInvocation,
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

/** 同步/异步通吃:handler 返回 Promise 时,耗时在 Promise settle 后才记入 recentSyncOperations。 */
export function trackInvocation<T>(descriptor: OperationDescriptor, invoke: () => T | Promise<T>): T | Promise<T> {
  return operationDiagnostics.trackInvocation(descriptor, invoke)
}

function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === 'function'
}

export function operationDiagnosticsContext(): OperationDiagnosticsSnapshot {
  return operationDiagnostics.consumeSnapshot()
}
