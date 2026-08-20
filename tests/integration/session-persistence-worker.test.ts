import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { events, type AppEvents } from '../../src/core/events.js'
import { sessionManager } from '../../src/core/sessions.js'
import { createWorkerWriteDataPort, type WorkerWriteDataPort } from '../../src/data-worker/writer-worker/client.js'
import type { WriteBatch, WriteDataPort } from '../../src/ports/write-data-port.js'
import { setWriteDataPort } from '../../src/core/persistence/write-data-port-provider.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { eventStore, sessionStore } from '../../src/store/sessions.js'

let tmp: string
let writer: WorkerWriteDataPort | undefined
let resetWritePort: (() => void) | undefined

beforeEach(async () => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-persistence-'))
  const dbPath = resolve(tmp, 'ai-ide.sqlite')
  initDatabase(dbPath)
  writer = await createWorkerWriteDataPort({ dbPath })
})

afterEach(async () => {
  resetWritePort?.()
  resetWritePort = undefined
  await writer?.close()
  writer = undefined
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('session persistence through Writer Worker', () => {
  it('persists pending updates before done and publishes committed done only after critical ack', async () => {
    const session = sessionStore.create({ agentId: 'agent-persistence' })
    let releaseCritical: (() => void) | undefined
    const criticalGate = new Promise<void>((resolveGate) => { releaseCritical = resolveGate })
    const delayedPort: WriteDataPort = {
      async commitBatch(batch: WriteBatch) {
        if (batch.priority === 'critical') await criticalGate
        if (!writer) throw new Error('writer missing')
        return writer.commitBatch(batch)
      },
      sessionCursor: (sessionId) => writer?.sessionCursor(sessionId) ?? Promise.resolve({ sequence: 0 }),
      drain: () => writer?.drain() ?? Promise.resolve(),
      close: () => Promise.resolve(),
    }
    resetWritePort = setWriteDataPort(delayedPort)
    const committed: AppEvents['session:committed_done'][] = []
    const onCommitted = (event: AppEvents['session:committed_done']): void => { committed.push(event) }
    events.on('session:committed_done', onCommitted)

    try {
      events.emit('session:update', {
        sessionId: session.id,
        agentId: session.agent_id,
        data: { messageId: 'message-persistence', role: 'agent', contentDelta: 'persist me' },
      })
      events.emit('session:done', {
        sessionId: session.id,
        agentId: session.agent_id,
        messageId: 'message-persistence',
        stopReason: 'end_turn',
      })
      await delay(20)

      expect(committed).toEqual([])
      releaseCritical?.()
      await sessionManager.waitForPersistence(session.id)

      const persisted = eventStore.list(session.id)
      expect(persisted.map((event) => event.type)).toEqual(['message.chunk', 'message.done'])
      expect(persisted[0].sequence).toBeLessThan(persisted[1].sequence)
      expect(committed).toHaveLength(1)
      expect(committed[0]).toMatchObject({ sessionId: session.id, messageId: 'message-persistence' })
    } finally {
      events.off('session:committed_done', onCommitted)
    }
  })

  it('continues terminal persistence after a committed background batch reports failure', async () => {
    const session = sessionStore.create({ agentId: 'agent-stale-background-error' })
    let failedBackground = false
    const staleFailurePort: WriteDataPort = {
      async commitBatch(batch: WriteBatch) {
        if (!writer) throw new Error('writer missing')
        const result = await writer.commitBatch(batch)
        if (batch.priority === 'background' && !failedBackground) {
          failedBackground = true
          throw new Error('simulated lost writer acknowledgement')
        }
        return result
      },
      sessionCursor: (sessionId) => writer?.sessionCursor(sessionId) ?? Promise.resolve({ sequence: 0 }),
      enqueueRuntimeCommand: (input) => {
        if (!writer) throw new Error('writer missing')
        return writer.enqueueRuntimeCommand(input)
      },
      listRecoverableRuntimeCommands: (input) => {
        if (!writer) throw new Error('writer missing')
        return writer.listRecoverableRuntimeCommands(input)
      },
      updateRuntimeCommand: (input) => {
        if (!writer) throw new Error('writer missing')
        return writer.updateRuntimeCommand(input)
      },
      maintain: (input) => {
        if (!writer) throw new Error('writer missing')
        return writer.maintain(input)
      },
      drain: () => writer?.drain() ?? Promise.resolve(),
      close: () => Promise.resolve(),
    }
    resetWritePort = setWriteDataPort(staleFailurePort)

    events.emit('session:update', {
      sessionId: session.id,
      agentId: session.agent_id,
      data: { messageId: 'message-stale-background-error', role: 'agent', contentDelta: 'persisted' },
    })
    await delay(20)
    events.emit('session:done', {
      sessionId: session.id,
      agentId: session.agent_id,
      messageId: 'message-stale-background-error',
      stopReason: 'end_turn',
    })

    await expect(sessionManager.waitForPersistence(session.id)).resolves.toBeUndefined()
    expect(eventStore.list(session.id).map((event) => event.type)).toEqual([
      'message.chunk',
      'message.done',
    ])
  })
})

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}
