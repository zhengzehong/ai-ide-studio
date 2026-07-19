import { cpus } from 'node:os'

export type RuntimeResourceKind = 'network' | 'cpu' | 'disk'

export interface RuntimeResourceLimits {
  network: number
  cpu: number
  disk: number
}

export interface ResourceLease {
  release(): void
}

interface Waiter {
  resolve: (lease: ResourceLease) => void
  reject: (error: Error) => void
}

interface ResourceState {
  limit: number
  active: number
  waiters: Waiter[]
}

export function defaultRuntimeResourceLimits(cpuCount = cpus().length): RuntimeResourceLimits {
  return {
    network: 32,
    cpu: Math.max(2, Math.floor(cpuCount / 2)),
    disk: 2,
  }
}

export class ResourceGovernor {
  private readonly resources: Record<RuntimeResourceKind, ResourceState>
  private closed = false

  constructor(limits: RuntimeResourceLimits = defaultRuntimeResourceLimits()) {
    this.resources = {
      network: resourceState(limits.network),
      cpu: resourceState(limits.cpu),
      disk: resourceState(limits.disk),
    }
  }

  acquire(kind: RuntimeResourceKind): Promise<ResourceLease> {
    if (this.closed) return Promise.reject(new Error('Resource governor is closed'))
    const state = this.resources[kind]
    if (state.active < state.limit) {
      state.active += 1
      return Promise.resolve(this.lease(kind))
    }
    return new Promise<ResourceLease>((resolve, reject) => state.waiters.push({ resolve, reject }))
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    const error = new Error('Resource governor is closed')
    for (const state of Object.values(this.resources)) {
      for (const waiter of state.waiters.splice(0)) waiter.reject(error)
    }
  }

  private lease(kind: RuntimeResourceKind): ResourceLease {
    let released = false
    return {
      release: () => {
        if (released) return
        released = true
        const state = this.resources[kind]
        const waiter = this.closed ? undefined : state.waiters.shift()
        if (waiter) waiter.resolve(this.lease(kind))
        else state.active = Math.max(0, state.active - 1)
      },
    }
  }
}

function resourceState(limit: number): ResourceState {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Resource limits must be positive integers')
  return { limit, active: 0, waiters: [] }
}
