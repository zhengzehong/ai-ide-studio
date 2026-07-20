import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createWorkerWriteDataPort,
  type WorkerWriteDataPort,
} from '../../src/data-worker/writer-worker/client.js'
import { RuntimeCommandDispatcher } from '../../src/commands/runtime-command-dispatcher.js'
import type { RuntimeCommandInput } from '../../src/ports/write-data-port.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { messageStore } from '../../src/store/sessions.js'

let tmp: string
let dbPath: string
let writer: WorkerWriteDataPort | undefined

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-runtime-command-'))
  dbPath = resolve(tmp, 'ai-ide.sqlite')
  initDatabase(dbPath)
  closeDatabase()
})

afterEach(async () => {
  await writer?.close()
  writer = undefined
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('Runtime command ledger', () => {
  it('executes permission and cancel controls while a running prompt is unresolved', async () => {
    writer = await createWorkerWriteDataPort({ dbPath })
    const promptGate = deferred<void>()
    const executed: string[] = []
    const dispatcher = new RuntimeCommandDispatcher({
      ledger: writer,
      execute: async (command) => {
        executed.push(command.type)
        if (command.type === 'prompt') await promptGate.promise
      },
    })
    await dispatcher.start()

    const prompt = await dispatcher.submit(promptCommand('command-prompt', 'key-prompt', 'message-prompt'))
    await waitUntil(() => executed.includes('prompt'))
    const permission = await dispatcher.submit(permissionCommand())
    const cancel = await dispatcher.submit(cancelCommand())

    try {
      await waitUntil(() => executed.includes('permission.respond') && executed.includes('session.cancel'))
      await expect(Promise.all([permission.completion, cancel.completion])).resolves.toHaveLength(2)
    } finally {
      promptGate.resolve()
      await Promise.allSettled([prompt.completion, permission.completion, cancel.completion])
      dispatcher.closeIntake()
      await dispatcher.drain()
    }
  })

  it('keeps prompts ordered within the same session turn lane', async () => {
    writer = await createWorkerWriteDataPort({ dbPath })
    const firstPromptGate = deferred<void>()
    const executed: string[] = []
    const dispatcher = new RuntimeCommandDispatcher({
      ledger: writer,
      execute: async (command) => {
        executed.push(command.commandId)
        if (command.commandId === 'command-prompt-1') await firstPromptGate.promise
      },
    })
    await dispatcher.start()

    const first = await dispatcher.submit(promptCommand('command-prompt-1', 'key-prompt-1', 'message-prompt-1'))
    await waitUntil(() => executed.includes('command-prompt-1'))
    const second = await dispatcher.submit(promptCommand('command-prompt-2', 'key-prompt-2', 'message-prompt-2'))

    try {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
      expect(executed).toEqual(['command-prompt-1'])
      firstPromptGate.resolve()
      await expect(Promise.all([first.completion, second.completion])).resolves.toHaveLength(2)
      expect(executed).toEqual(['command-prompt-1', 'command-prompt-2'])
    } finally {
      firstPromptGate.resolve()
      await Promise.allSettled([first.completion, second.completion])
      dispatcher.closeIntake()
      await dispatcher.drain()
    }
  })

  it('persists accepted commands and returns the original row for an idempotent retry', async () => {
    writer = await createWorkerWriteDataPort({ dbPath })
    const command = promptCommand('command-1', 'idempotency-1', 'message-1')

    const first = await writer.enqueueRuntimeCommand(command)
    const second = await writer.enqueueRuntimeCommand({ ...command, commandId: 'command-retry' })

    expect(first).toMatchObject({ duplicate: false, conflict: false })
    expect(first.command).toMatchObject({ commandId: 'command-1', status: 'accepted', attempts: 0 })
    expect(second).toMatchObject({ duplicate: true, conflict: false })
    expect(second.command.commandId).toBe('command-1')
  })

  it('reports an idempotency conflict when the same key carries different payload', async () => {
    writer = await createWorkerWriteDataPort({ dbPath })
    const command = promptCommand('command-1', 'idempotency-1', 'message-1')
    await writer.enqueueRuntimeCommand(command)

    const conflict = await writer.enqueueRuntimeCommand({
      ...command,
      commandId: 'command-2',
      payload: { ...command.payload, content: 'different' },
    })

    expect(conflict).toMatchObject({ duplicate: true, conflict: true })
    expect(conflict.command.commandId).toBe('command-1')
  })

  it('recovers accepted and running commands in creation order after Worker restart', async () => {
    writer = await createWorkerWriteDataPort({ dbPath })
    await writer.enqueueRuntimeCommand(promptCommand('command-1', 'key-1', 'message-1', '2026-07-20T01:00:00.000Z'))
    await writer.enqueueRuntimeCommand(promptCommand('command-2', 'key-2', 'message-2', '2026-07-20T01:00:01.000Z'))
    await writer.updateRuntimeCommand({
      commandId: 'command-2',
      status: 'running',
      updatedAt: '2026-07-20T01:00:02.000Z',
    })
    await writer.close()

    writer = await createWorkerWriteDataPort({ dbPath })
    const recovered = await writer.listRecoverableRuntimeCommands(10)

    expect(recovered.map((command) => [command.commandId, command.status])).toEqual([
      ['command-1', 'accepted'],
      ['command-2', 'running'],
    ])
    expect(recovered.every((command) => command.humanMessagePersisted === false)).toBe(true)
  })

  it('marks whether a running Prompt already persisted its human message', async () => {
    writer = await createWorkerWriteDataPort({ dbPath })
    await writer.enqueueRuntimeCommand(promptCommand('command-1', 'key-1', 'message-persisted'))
    await writer.updateRuntimeCommand({
      commandId: 'command-1',
      status: 'running',
      updatedAt: '2026-07-20T01:00:01.000Z',
    })
    await writer.close()
    writer = undefined

    initDatabase(dbPath)
    messageStore.append('session-1', {
      id: 'message-persisted',
      role: 'human',
      content: 'already stored',
    })
    closeDatabase()

    writer = await createWorkerWriteDataPort({ dbPath })
    const [recovered] = await writer.listRecoverableRuntimeCommands(10)

    expect(recovered).toMatchObject({
      commandId: 'command-1',
      status: 'running',
      humanMessagePersisted: true,
    })
  })

  it('persists terminal status and excludes terminal commands from recovery', async () => {
    writer = await createWorkerWriteDataPort({ dbPath })
    await writer.enqueueRuntimeCommand(promptCommand('command-1', 'key-1', 'message-1'))

    const completed = await writer.updateRuntimeCommand({
      commandId: 'command-1',
      status: 'completed',
      updatedAt: '2026-07-20T01:00:02.000Z',
    })

    expect(completed).toMatchObject({ commandId: 'command-1', status: 'completed', attempts: 0 })
    await expect(writer.listRecoverableRuntimeCommands(10)).resolves.toEqual([])
  })
})

function promptCommand(
  commandId: string,
  idempotencyKey: string,
  clientMessageId: string,
  createdAt = '2026-07-20T01:00:00.000Z',
) {
  return {
    commandId,
    idempotencyKey,
    type: 'prompt' as const,
    sessionId: 'session-1',
    projectId: 'project-1',
    payload: {
      commandId,
      type: 'prompt' as const,
      sessionId: 'session-1',
      clientMessageId,
      content: 'hello',
    },
    createdAt,
  }
}

function permissionCommand(): RuntimeCommandInput {
  return {
    commandId: 'command-permission',
    idempotencyKey: 'key-permission',
    type: 'permission.respond',
    sessionId: 'session-1',
    payload: {
      commandId: 'command-permission',
      type: 'permission.respond',
      sessionId: 'session-1',
      permissionRequestId: 'permission-1',
      optionId: 'allow-once',
    },
    createdAt: '2026-07-20T01:00:01.000Z',
  }
}

function cancelCommand(): RuntimeCommandInput {
  return {
    commandId: 'command-cancel',
    idempotencyKey: 'key-cancel',
    type: 'session.cancel',
    sessionId: 'session-1',
    payload: {
      commandId: 'command-cancel',
      type: 'session.cancel',
      sessionId: 'session-1',
    },
    createdAt: '2026-07-20T01:00:02.000Z',
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for command execution')
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10))
  }
}
