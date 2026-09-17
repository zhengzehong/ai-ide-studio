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
  private readonly snapshotDropWarned = new Set<string>()

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
      const changes = await sessionPersistencePort.updateRunningSnapshot(sessionId, messageId, content)
      if (changes === 0) this.warnSnapshotDropped(sessionId, messageId)
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

  /**
   * 快照被写入侧守卫拦截(行已终态)时留痕:迟到内容只存在于 session_events,
   * 静默丢弃会让"真终稿丢失"不可观测(2026-09-17 sess-d83044f2 事故)。
   * 同一 messageId 只 warn 一次,重复降为 debug,避免长回合刷屏。
   */
  private warnSnapshotDropped(sessionId: string, messageId: string): void {
    const key = `${sessionId}:${messageId}`
    const first = !this.snapshotDropWarned.has(key)
    if (this.snapshotDropWarned.size > 1000) this.snapshotDropWarned.clear()
    this.snapshotDropWarned.add(key)
    if (first) {
      log.warn(
        { sessionId, messageId },
        'running snapshot dropped: message row already terminal; late content remains only in session events',
      )
    } else {
      log.debug({ sessionId, messageId }, 'running snapshot dropped (repeat)')
    }
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
