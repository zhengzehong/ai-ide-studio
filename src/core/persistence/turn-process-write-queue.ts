import { createChildLogger } from '../logger.js'
import type {
  TurnProcessItemWriteInput,
  TurnProcessItemWriteResult,
  TurnProcessTextAppendInput,
  WriteMutation,
} from '../../ports/write-data-port.js'
import { sessionPersistencePort } from './session-persistence-port.js'

const log = createChildLogger('turn-process-write-queue')

interface SessionWriteState {
  chain: Promise<void>
  pending: number
}

class TurnProcessWriteQueue {
  private readonly sessions = new Map<string, SessionWriteState>()

  upsert(
    input: TurnProcessItemWriteInput,
    onCommitted: (item: TurnProcessItemWriteResult) => void,
  ): void {
    this.enqueueItem(input.sessionId, {
      type: 'turn-process.item.upsert',
      item: input,
    }, onCommitted)
  }

  appendText(
    input: TurnProcessTextAppendInput,
    onCommitted: (item: TurnProcessItemWriteResult) => void,
  ): void {
    this.enqueueItem(input.sessionId, {
      type: 'turn-process.text.append',
      item: input,
    }, onCommitted)
  }

  snapshot(sessionId: string, messageId: string, content: string): void {
    this.enqueue(sessionId, async () => {
      await sessionPersistencePort.updateRunningSnapshot(sessionId, messageId, content)
    })
  }

  async drain(sessionId: string): Promise<void> {
    await this.sessions.get(sessionId)?.chain
  }

  finish(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (state?.pending === 0) this.sessions.delete(sessionId)
  }

  reset(): void {
    this.sessions.clear()
  }

  private enqueueItem(
    sessionId: string,
    mutation: WriteMutation,
    onCommitted: (item: TurnProcessItemWriteResult) => void,
  ): void {
    this.enqueue(sessionId, async () => {
      const batch = await sessionPersistencePort.commitMutations(sessionId, 'background', [mutation])
      const result = batch.results[0]
      if (!result || (result.type !== 'turn-process.item.upsert' && result.type !== 'turn-process.text.append')) {
        throw new Error(`Writer batch ${batch.batchId} did not return a turn process item`)
      }
      onCommitted(result.item)
    })
  }

  private enqueue(sessionId: string, work: () => Promise<void>): void {
    const state = this.sessions.get(sessionId) ?? { chain: Promise.resolve(), pending: 0 }
    state.pending += 1
    state.chain = state.chain.then(work, work).catch((err: unknown) => {
      log.error({ err, sessionId }, 'turn process persistence failed; continuing Session write chain')
    }).finally(() => {
      state.pending -= 1
      if (state.pending === 0 && this.sessions.get(sessionId) === state) this.sessions.delete(sessionId)
    })
    this.sessions.set(sessionId, state)
  }
}

export const turnProcessWriteQueue = new TurnProcessWriteQueue()
