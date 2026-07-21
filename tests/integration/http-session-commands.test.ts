import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  RuntimeCommandRecord,
  RuntimeCommandInput,
} from '../../src/ports/write-data-port.js'
import type {
  RuntimeCommandSubmission,
} from '../../src/commands/runtime-command-dispatcher.js'
import type { SessionCommandDispatcherPort } from '../../src/gateway/http/session-command-routes.js'
import { startGateway } from '../../src/gateway/server.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'

const ACCESS_TOKEN = 'command-route-secret'
let tmp: string
let server: Server | undefined
let dispatcher: FakeDispatcher

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-http-command-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
  dispatcher = new FakeDispatcher()
})

afterEach(async () => {
  if (server) await new Promise<void>((resolveClose) => server?.close(() => resolveClose()))
  server = undefined
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('HTTP Session commands', () => {
  it('requires owner authentication and accepts Prompt with durable idempotency metadata', async () => {
    await startTestGateway()
    const body = promptBody()

    const unauthorized = await fetch(`${baseUrl()}/api/v1/commands`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'key-1' },
    })
    const accepted = await commandFetch(body, 'key-1')

    expect(unauthorized.status).toBe(401)
    expect(accepted.status).toBe(202)
    expect(await accepted.json()).toEqual({
      data: { commandId: 'command-1', status: 'accepted', duplicate: false },
    })
    expect(dispatcher.submit).toHaveBeenCalledWith(expect.objectContaining({
      commandId: 'command-1',
      idempotencyKey: 'key-1',
      type: 'prompt',
      sessionId: 'session-1',
      payload: body,
    }))
  })

  it('waits for short commands and maps validation, conflict, and availability failures', async () => {
    await startTestGateway()
    const completed = await commandFetch({
      commandId: 'command-read',
      type: 'sessions.markRead',
      sessionId: 'session-1',
    }, 'key-read')

    const invalid = await commandFetch({
      commandId: 'command-invalid',
      type: 'tasks.list',
      sessionId: 'session-1',
    }, 'key-invalid')
    dispatcher.error = new Error('幂等键已用于不同命令: command-1')
    dispatcher.error.name = 'RuntimeCommandConflictError'
    const conflict = await commandFetch(promptBody(), 'key-conflict')
    dispatcher.error = new Error('命令服务暂不可用')
    dispatcher.error.name = 'RuntimeCommandUnavailableError'
    const unavailable = await commandFetch(promptBody(), 'key-unavailable')

    expect(completed.status).toBe(200)
    expect(await completed.json()).toEqual({
      data: { commandId: 'command-read', status: 'completed', duplicate: false },
    })
    expect(invalid.status).toBe(400)
    expect(conflict.status).toBe(409)
    expect(unavailable.status).toBe(503)
  })

  it('rejects missing idempotency keys and oversized bodies', async () => {
    await startTestGateway()
    const missingKey = await fetch(`${baseUrl()}/api/v1/commands`, {
      method: 'POST',
      body: JSON.stringify(promptBody()),
      headers: {
        'Content-Type': 'application/json',
        'x-ai-ide-token': ACCESS_TOKEN,
      },
    })
    const oversized = await commandFetch({
      ...promptBody(),
      content: 'x'.repeat(2 * 1024 * 1024),
    }, 'key-large')

    expect(missingKey.status).toBe(400)
    expect(oversized.status).toBe(413)
    expect(dispatcher.submit).not.toHaveBeenCalled()
  })
})

class FakeDispatcher implements SessionCommandDispatcherPort {
  error: Error | undefined
  submit = vi.fn(async (input: RuntimeCommandInput): Promise<RuntimeCommandSubmission> => {
    if (this.error) throw this.error
    const command: RuntimeCommandRecord = {
      ...input,
      status: input.type === 'prompt' ? 'accepted' : 'completed',
      attempts: input.type === 'prompt' ? 0 : 1,
      updatedAt: input.createdAt,
      humanMessagePersisted: false,
    }
    return { command, duplicate: false, completion: Promise.resolve({ ...command, status: 'completed' }) }
  })
}

async function startTestGateway(): Promise<void> {
  const handle = await startGateway({
    host: '127.0.0.1',
    port: 0,
    dataDir: tmp,
    runtime: 'web',
    localToken: ACCESS_TOKEN,
  }, { commandDispatcher: dispatcher })
  server = handle.server
}

function promptBody() {
  return {
    commandId: 'command-1',
    type: 'prompt',
    sessionId: 'session-1',
    clientMessageId: 'message-1',
    content: 'hello',
  }
}

function commandFetch(body: unknown, idempotencyKey: string): Promise<Response> {
  return fetch(`${baseUrl()}/api/v1/commands`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'x-ai-ide-token': ACCESS_TOKEN,
    },
  })
}

function baseUrl(): string {
  const address = server?.address()
  if (!address || typeof address === 'string') throw new Error('test server not listening')
  return `http://127.0.0.1:${address.port}`
}
