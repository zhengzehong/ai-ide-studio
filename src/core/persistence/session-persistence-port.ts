import { randomUUID } from 'node:crypto'
import type { SessionEventWriteResult, WriteBatchResult, WriteMutation } from '../../ports/write-data-port.js'
import type { WritePriority } from '../../data-worker/protocol.js'
import { getWriteDataPort } from './write-data-port-provider.js'
import { onBeforeDatabaseClose } from '../../store/db.js'

export interface PersistSessionEventInput {
  type: string
  agentId?: string
  acpSessionId?: string
  messageId?: string
  role?: string
  payload: unknown
}

class SessionPersistencePort {
  private readonly generations = new Map<string, string>()
  private readonly sequences = new Map<string, number>()
  private readonly sequenceInitializers = new Map<string, Promise<void>>()

  appendEvent(
    sessionId: string,
    input: PersistSessionEventInput,
    priority: WritePriority = 'background',
  ): Promise<SessionEventWriteResult> {
    const eventId = `evt-${randomUUID()}`
    const createdAt = new Date().toISOString()
    const mutations: WriteMutation[] = [{
      type: 'session.event.append',
      event: {
        id: eventId,
        sessionId,
        agentId: input.agentId,
        acpSessionId: input.acpSessionId,
        messageId: input.messageId,
        eventType: input.type,
        role: input.role,
        payload: input.payload,
        createdAt,
      },
    }]
    if (priority === 'critical' && input.type === 'message.done') {
      mutations.push({
        type: 'outbox.enqueue',
        event: {
          id: `outbox-${randomUUID()}`,
          topic: 'session.done',
          aggregateType: 'session',
          aggregateId: sessionId,
          sessionId,
          payload: input.payload,
          createdAt,
        },
      })
    }
    return this.commit(sessionId, priority, mutations).then((result) => {
      const eventResult = result.results.find((item) => item.type === 'session.event.append')
      if (!eventResult || eventResult.type !== 'session.event.append') {
        throw new Error(`Writer batch ${result.batchId} did not return a session event`)
      }
      return eventResult.event
    })
  }

  async updateRunningSnapshot(sessionId: string, messageId: string, content: string): Promise<void> {
    await this.commit(sessionId, 'background', [{
      type: 'message.snapshot.update',
      messageId,
      content,
      timestamp: new Date().toISOString(),
    }])
  }

  async flush(): Promise<void> {
    await getWriteDataPort().drain()
  }

  finishSession(sessionId: string): void {
    this.generations.delete(sessionId)
    this.sequences.delete(sessionId)
    this.sequenceInitializers.delete(sessionId)
  }

  reset(): void {
    this.generations.clear()
    this.sequences.clear()
    this.sequenceInitializers.clear()
  }

  private async commit(
    sessionId: string,
    priority: WritePriority,
    mutations: WriteMutation[],
  ): Promise<WriteBatchResult> {
    await this.initializeSequence(sessionId)
    const sequence = this.nextSequence(sessionId)
    return getWriteDataPort().commitBatch({
      batchId: `batch-${randomUUID()}`,
      priority,
      sessionId,
      streamGeneration: this.generation(sessionId),
      firstSequence: sequence,
      lastSequence: sequence,
      mutations,
    })
  }

  private initializeSequence(sessionId: string): Promise<void> {
    if (this.sequences.has(sessionId)) return Promise.resolve()
    const current = this.sequenceInitializers.get(sessionId)
    if (current) return current
    const initializer = getWriteDataPort().sessionCursor(sessionId).then((cursor) => {
      if (!this.sequences.has(sessionId)) this.sequences.set(sessionId, cursor.sequence)
    }).finally(() => {
      this.sequenceInitializers.delete(sessionId)
    })
    this.sequenceInitializers.set(sessionId, initializer)
    return initializer
  }

  private generation(sessionId: string): string {
    const current = this.generations.get(sessionId)
    if (current) return current
    const generation = randomUUID()
    this.generations.set(sessionId, generation)
    return generation
  }

  private currentSequence(sessionId: string): number {
    return this.sequences.get(sessionId) ?? 0
  }

  private nextSequence(sessionId: string): number {
    const next = this.currentSequence(sessionId) + 1
    this.sequences.set(sessionId, next)
    return next
  }
}

export const sessionPersistencePort = new SessionPersistencePort()

onBeforeDatabaseClose(() => sessionPersistencePort.reset())
