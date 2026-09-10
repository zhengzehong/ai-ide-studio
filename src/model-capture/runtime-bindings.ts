import type { ChildProcess } from 'node:child_process'
import { acquireCaptureRoute, retainCaptureRoute, type CaptureRouteBinding } from './route-bindings.js'

/** API owns pending IPC leases separately: a caller timeout is not a Runtime stop. */
export class RuntimeCaptureBindings {
  private readonly pending = new Map<string, () => void>()
  private readonly active = new Map<string, { id: string; release: () => void }>()

  beginRequest(requestId: string, binding: CaptureRouteBinding | undefined): void {
    if (binding) this.pending.set(requestId, retainCaptureRoute(binding))
  }

  endRequest(requestId: string): void {
    this.pending.get(requestId)?.()
    this.pending.delete(requestId)
  }

  agentStatus(event: { agentId: string; status: string; captureBindingId?: string }): void {
    const current = this.active.get(event.agentId)
    if (event.status === 'running') {
      if (current?.id === event.captureBindingId) return
      const lease = event.captureBindingId ? acquireCaptureRoute(event.captureBindingId) : undefined
      current?.release()
      this.active.delete(event.agentId)
      if (lease) this.active.set(event.agentId, { id: lease.binding.id, release: lease.release })
    } else if (current && current.id === event.captureBindingId) {
      current.release()
      this.active.delete(event.agentId)
    }
  }

  clear(): void {
    for (const release of this.pending.values()) release()
    for (const entry of this.active.values()) entry.release()
    this.pending.clear()
    this.active.clear()
  }
}

export function spawnWithCaptureBinding(
  binding: CaptureRouteBinding | undefined,
  spawn: () => ChildProcess,
): ChildProcess {
  const release = binding ? retainCaptureRoute(binding) : (): void => {}
  try {
    const child = spawn()
    child.once('exit', release)
    child.once('error', release)
    return child
  } catch (error) {
    release()
    throw error
  }
}
