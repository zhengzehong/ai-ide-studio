import { randomUUID } from 'node:crypto'

export interface RuntimeStreamCursor {
  streamGeneration: string
  sequence: number
}

export interface RuntimeSessionActorSchedulerOptions {
  maxMailboxItems?: number
  maxMailboxBytes?: number
  generationFactory?: () => string
}

interface SessionActorState {
  tail: Promise<void>
  pendingItems: number
  pendingBytes: number
  streamGeneration: string
  sequence: number
}

export class RuntimeBackpressureError extends Error {
  readonly code = 'RUNTIME_BACKPRESSURE'

  constructor(sessionId: string) {
    super(`Runtime mailbox is full for Session ${sessionId}`)
    this.name = 'RuntimeBackpressureError'
  }
}

export class RuntimeSessionActorScheduler {
  private readonly actors = new Map<string, SessionActorState>()
  private readonly maxMailboxItems: number
  private readonly maxMailboxBytes: number
  private readonly generationFactory: () => string

  constructor(options: RuntimeSessionActorSchedulerOptions = {}) {
    this.maxMailboxItems = options.maxMailboxItems ?? 256
    this.maxMailboxBytes = options.maxMailboxBytes ?? 2 * 1024 * 1024
    this.generationFactory = options.generationFactory ?? randomUUID
  }

  enqueue<T>(sessionId: string, work: () => Promise<T> | T, options: { payloadBytes?: number } = {}): Promise<T> {
    const actor = this.actor(sessionId)
    const payloadBytes = Math.max(0, options.payloadBytes ?? 0)
    if (actor.pendingItems >= this.maxMailboxItems || actor.pendingBytes + payloadBytes > this.maxMailboxBytes) {
      return Promise.reject(new RuntimeBackpressureError(sessionId))
    }

    actor.pendingItems += 1
    actor.pendingBytes += payloadBytes
    const result = actor.tail.then(work)
    actor.tail = result
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        actor.pendingItems -= 1
        actor.pendingBytes -= payloadBytes
      })
    return result
  }

  currentCursor(sessionId: string): RuntimeStreamCursor {
    const actor = this.actor(sessionId)
    return { streamGeneration: actor.streamGeneration, sequence: actor.sequence }
  }

  nextCursor(sessionId: string): RuntimeStreamCursor {
    const actor = this.actor(sessionId)
    actor.sequence += 1
    return { streamGeneration: actor.streamGeneration, sequence: actor.sequence }
  }

  pendingCount(sessionId?: string): number {
    if (sessionId) return this.actors.get(sessionId)?.pendingItems ?? 0
    return [...this.actors.values()].reduce((total, actor) => total + actor.pendingItems, 0)
  }

  get actorCount(): number {
    return this.actors.size
  }

  resetSession(sessionId: string): void {
    const actor = this.actors.get(sessionId)
    if (actor && actor.pendingItems > 0) {
      throw new Error(`Cannot reset active Session actor: ${sessionId}`)
    }
    this.actors.delete(sessionId)
  }

  async drain(): Promise<void> {
    await Promise.all([...this.actors.values()].map((actor) => actor.tail))
  }

  private actor(sessionId: string): SessionActorState {
    const current = this.actors.get(sessionId)
    if (current) return current
    const actor: SessionActorState = {
      tail: Promise.resolve(),
      pendingItems: 0,
      pendingBytes: 0,
      streamGeneration: this.generationFactory(),
      sequence: 0,
    }
    this.actors.set(sessionId, actor)
    return actor
  }
}
