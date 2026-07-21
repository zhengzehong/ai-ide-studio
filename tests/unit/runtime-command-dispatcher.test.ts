import { describe, expect, it, vi } from 'vitest'
import {
  RuntimeCommandConflictError,
  RuntimeCommandDispatcher,
  RuntimeCommandUnavailableError,
  type RuntimeCommandLedgerPort,
} from '../../src/commands/runtime-command-dispatcher.js'
import type {
  RuntimeCommandEnqueueResult,
  RuntimeCommandInput,
  RuntimeCommandRecord,
  RuntimeCommandUpdate,
} from '../../src/ports/write-data-port.js'

describe('RuntimeCommandDispatcher', () => {
  it('runs commands FIFO per Session while allowing different Sessions concurrently', async () => {
    const ledger = new FakeLedger([
      record('command-a1', 'session-a', 'accepted', '2026-07-20T01:00:00.000Z'),
      record('command-a2', 'session-a', 'accepted', '2026-07-20T01:00:01.000Z'),
      record('command-b1', 'session-b', 'accepted', '2026-07-20T01:00:02.000Z'),
    ])
    const releaseA = deferred<void>()
    const started: string[] = []
    const dispatcher = new RuntimeCommandDispatcher({
      ledger,
      execute: async (command) => {
        started.push(command.commandId)
        if (command.commandId === 'command-a1') await releaseA.promise
      },
      now: () => '2026-07-20T01:01:00.000Z',
    })

    await dispatcher.start()
    await vi.waitFor(() => expect(started).toContain('command-b1'))
    expect(started).toEqual(['command-a1', 'command-b1'])
    releaseA.resolve()
    await dispatcher.drain()

    expect(started).toEqual(['command-a1', 'command-b1', 'command-a2'])
    expect(ledger.rows.every((command) => command.status === 'completed')).toBe(true)
  })

  it('interrupts a running Prompt with a persisted human message instead of replaying it', async () => {
    const persisted = record('command-1', 'session-1', 'running')
    persisted.humanMessagePersisted = true
    const ledger = new FakeLedger([persisted])
    const execute = vi.fn()
    const dispatcher = new RuntimeCommandDispatcher({
      ledger,
      execute,
      now: () => '2026-07-20T01:01:00.000Z',
    })

    await dispatcher.start()
    await dispatcher.drain()

    expect(execute).not.toHaveBeenCalled()
    expect(ledger.rows[0]).toMatchObject({
      status: 'interrupted',
      error: 'API 重启时命令已写入用户消息，禁止重复执行',
    })
  })

  it('deduplicates concurrent submissions with the same idempotency key', async () => {
    const ledger = new FakeLedger()
    const release = deferred<void>()
    const execute = vi.fn(async () => release.promise)
    const dispatcher = new RuntimeCommandDispatcher({
      ledger,
      execute,
      now: () => '2026-07-20T01:01:00.000Z',
    })
    await dispatcher.start()
    const command = commandInput('command-1', 'key-1')

    const first = await dispatcher.submit(command)
    const second = await dispatcher.submit({ ...command, commandId: 'command-retry' })

    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    release.resolve()
    await expect(first.completion).resolves.toMatchObject({ status: 'completed' })
    await expect(second.completion).resolves.toMatchObject({ status: 'completed' })
  })

  it('rejects conflicting retries and records execution failures', async () => {
    const ledger = new FakeLedger()
    const dispatcher = new RuntimeCommandDispatcher({
      ledger,
      execute: async () => { throw new Error('runtime unavailable') },
      now: () => '2026-07-20T01:01:00.000Z',
    })
    await dispatcher.start()
    const command = commandInput('command-1', 'key-1')
    const submitted = await dispatcher.submit(command)

    await expect(submitted.completion).rejects.toThrow('runtime unavailable')
    expect(ledger.rows[0]).toMatchObject({ status: 'failed', error: 'runtime unavailable' })
    await expect(dispatcher.submit({
      ...command,
      commandId: 'command-conflict',
      payload: { ...command.payload, content: 'different' },
    })).rejects.toBeInstanceOf(RuntimeCommandConflictError)
  })

  it('stops intake but drains work already accepted', async () => {
    const ledger = new FakeLedger()
    const release = deferred<void>()
    const dispatcher = new RuntimeCommandDispatcher({
      ledger,
      execute: async () => release.promise,
      now: () => '2026-07-20T01:01:00.000Z',
    })
    await dispatcher.start()
    const submitted = await dispatcher.submit(commandInput('command-1', 'key-1'))

    dispatcher.closeIntake()
    await expect(dispatcher.submit(commandInput('command-2', 'key-2')))
      .rejects.toBeInstanceOf(RuntimeCommandUnavailableError)
    release.resolve()
    await dispatcher.drain()
    await expect(submitted.completion).resolves.toMatchObject({ status: 'completed' })
  })

  it('recovers every command across deterministic cursor pages', async () => {
    const rows = Array.from({ length: 1005 }, (_, index) => record(
      `command-${String(index).padStart(4, '0')}`,
      `session-${index}`,
      'accepted',
      '2026-07-20T01:00:00.000Z',
    ))
    const ledger = new FakeLedger(rows)
    const execute = vi.fn(async () => undefined)
    const dispatcher = new RuntimeCommandDispatcher({
      ledger,
      execute,
      now: () => '2026-07-20T01:01:00.000Z',
    })

    await dispatcher.start()
    await dispatcher.drain()

    expect(execute).toHaveBeenCalledTimes(1005)
    expect(ledger.recoveryRequests).toEqual([
      { limit: 1000 },
      {
        limit: 1000,
        after: {
          createdAt: '2026-07-20T01:00:00.000Z',
          commandId: 'command-0999',
        },
      },
    ])
  })
})

class FakeLedger implements RuntimeCommandLedgerPort {
  rows: RuntimeCommandRecord[]
  recoveryRequests: Array<{
    limit: number
    after?: { createdAt: string; commandId: string }
  }> = []

  constructor(rows: RuntimeCommandRecord[] = []) {
    this.rows = rows
  }

  async enqueueRuntimeCommand(input: RuntimeCommandInput): Promise<RuntimeCommandEnqueueResult> {
    const existing = this.rows.find((row) => (
      row.type === input.type && row.idempotencyKey === input.idempotencyKey
    ))
    if (existing) {
      return {
        command: existing,
        duplicate: true,
        conflict: JSON.stringify(existing.payload) !== JSON.stringify(input.payload),
      }
    }
    const inserted: RuntimeCommandRecord = {
      ...input,
      status: 'accepted',
      attempts: 0,
      updatedAt: input.createdAt,
      humanMessagePersisted: false,
    }
    this.rows.push(inserted)
    return { command: inserted, duplicate: false, conflict: false }
  }

  async listRecoverableRuntimeCommands(
    input: number | { limit: number; after?: { createdAt: string; commandId: string } },
  ): Promise<RuntimeCommandRecord[]> {
    const request = typeof input === 'number' ? { limit: input } : input
    this.recoveryRequests.push(request)
    return this.rows
      .filter((row) => row.status === 'accepted' || row.status === 'running')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)
        || left.commandId.localeCompare(right.commandId))
      .filter((row) => !request.after
        || row.createdAt > request.after.createdAt
        || (row.createdAt === request.after.createdAt && row.commandId > request.after.commandId))
      .slice(0, request.limit)
  }

  async updateRuntimeCommand(input: RuntimeCommandUpdate): Promise<RuntimeCommandRecord> {
    const index = this.rows.findIndex((row) => row.commandId === input.commandId)
    if (index < 0) throw new Error('command missing')
    this.rows[index] = {
      ...this.rows[index],
      status: input.status,
      attempts: this.rows[index].attempts + (input.status === 'running' ? 1 : 0),
      updatedAt: input.updatedAt,
      ...(input.error ? { error: input.error } : {}),
    }
    return this.rows[index]
  }
}

function record(
  commandId: string,
  sessionId: string,
  status: RuntimeCommandRecord['status'],
  createdAt = '2026-07-20T01:00:00.000Z',
): RuntimeCommandRecord {
  const input = commandInput(commandId, `key-${commandId}`, sessionId, createdAt)
  return {
    ...input,
    status,
    attempts: status === 'running' ? 1 : 0,
    updatedAt: createdAt,
    humanMessagePersisted: false,
  }
}

function commandInput(
  commandId: string,
  idempotencyKey: string,
  sessionId = 'session-1',
  createdAt = '2026-07-20T01:00:00.000Z',
): RuntimeCommandInput {
  return {
    commandId,
    idempotencyKey,
    type: 'prompt',
    sessionId,
    payload: {
      commandId,
      type: 'prompt',
      sessionId,
      clientMessageId: `message-${commandId}`,
      content: 'hello',
    },
    createdAt,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
