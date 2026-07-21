import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { startApp, type AppHandle } from '../../src/app.js'
import { createWorkerWriteDataPort, type WorkerWriteDataPort } from '../../src/data-worker/writer-worker/client.js'
import type { RuntimeStateSnapshot } from '../../src/ports/runtime-port.js'
import { createWorkerQueryPort, type WorkerQueryPort } from '../../src/queries/worker-query-port.js'
import { createRealtimeProcess, type RealtimeProcessHandle } from '../../src/realtime/process-client.js'
import { createProcessRuntimePort, type ProcessRuntimePort } from '../../src/runtime/api/process-runtime-port.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { sessionStore } from '../../src/store/sessions.js'
import type { ServerMessage } from '../../src/types/ws-protocol.js'

let tmp: string
let dbPath: string
let query: WorkerQueryPort | undefined
let writer: WorkerWriteDataPort | undefined
let realtime: RealtimeProcessHandle | undefined
let runtime: ProcessRuntimePort | undefined
let app: AppHandle | undefined
const sockets: WebSocket[] = []

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-phase-5-failures-'))
  dbPath = resolve(tmp, 'ai-ide.sqlite')
  initDatabase(dbPath)
})

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close()
  await app?.stop().catch(() => undefined)
  app = undefined
  await runtime?.close().catch(() => undefined)
  runtime = undefined
  await realtime?.close().catch(() => undefined)
  realtime = undefined
  await query?.close().catch(() => undefined)
  query = undefined
  await writer?.close().catch(() => undefined)
  writer = undefined
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('Phase 5 process failure isolation', () => {
  it('fails Query requests explicitly while Realtime remains responsive', async () => {
    closeDatabase()
    query = await createWorkerQueryPort({ dbPath })
    realtime = await startRealtime()
    const client = await connect(realtime.endpointUrl)
    sockets.push(client.socket)

    await query.terminate()
    const pong = client.next('pong')
    client.send({ type: 'ping', timestamp: 1 })

    await expect(query.listTasks({})).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' })
    await expect(pong).resolves.toMatchObject({ type: 'pong', timestamp: 1 })
  })

  it('preserves accepted commands across Writer failure without a synchronous fallback', async () => {
    const session = sessionStore.create({ agentId: 'agent-writer-recovery' })
    closeDatabase()
    writer = await createWorkerWriteDataPort({ dbPath })
    await writer.enqueueRuntimeCommand({
      commandId: 'command-recoverable',
      idempotencyKey: 'idempotency-recoverable',
      type: 'sessions.markRead',
      sessionId: session.id,
      payload: { type: 'sessions.markRead', sessionId: session.id },
      createdAt: '2026-07-20T00:00:00.000Z',
    })

    await writer.terminate()
    await expect(writer.maintain({ force: false })).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' })

    writer = await createWorkerWriteDataPort({ dbPath })
    await expect(writer.listRecoverableRuntimeCommands({ limit: 10 })).resolves.toMatchObject([
      {
        commandId: 'command-recoverable',
        status: 'accepted',
      },
    ])
  })

  it('keeps Query available while Realtime restarts on a new generation', async () => {
    closeDatabase()
    query = await createWorkerQueryPort({ dbPath })
    realtime = await startRealtime()
    const generation = realtime.generation

    await realtime.terminateForTest()
    await expect(query.listTasks({})).resolves.toEqual([])
    await realtime.waitForRestart(generation)

    const client = await connect(realtime.endpointUrl)
    sockets.push(client.socket)
    const pong = client.next('pong')
    client.send({ type: 'ping', timestamp: 2 })
    await expect(pong).resolves.toMatchObject({ type: 'pong', timestamp: 2 })
  })

  it('restarts Runtime without false done and accepts a new prompt', async () => {
    closeDatabase()
    realtime = await startRealtime()
    const doneCounts = new Map<string, number>()
    runtime = await createProcessRuntimePort({
      realtimeStreamEndpoint: realtime.runtimeStreamEndpoint,
      realtimeStreamToken: realtime.runtimeStreamToken,
      restartDelayMs: 10,
      onPersistenceUpdate: async () => undefined,
      onDone: async (event) => {
        doneCounts.set(event.sessionId, (doneCounts.get(event.sessionId) ?? 0) + 1)
      },
    })
    const oldSessionId = 'session-runtime-crash'
    await runtime.ensureSession(snapshot(oldSessionId))
    const client = await connect(realtime.endpointUrl)
    sockets.push(client.socket)
    client.send({ type: 'subscribe', requestId: 'runtime', sessionIds: [oldSessionId, 'session-runtime-new'] })
    await client.next('result')
    const firstUpdate = client.next('session:update')
    const failedPrompt = runtime.prompt({
      agentId: 'agent-performance',
      sessionId: oldSessionId,
      content: 'x'.repeat(1_000),
    })
    await firstUpdate
    const generation = runtime.generation

    await runtime.terminateForTest()
    await expect(failedPrompt).rejects.toThrow('Runtime process exited')
    await runtime.waitForRestart(generation)
    await delay(100)
    expect(doneCounts.get(oldSessionId) ?? 0).toBe(0)

    const newSessionId = 'session-runtime-new'
    await runtime.ensureSession(snapshot(newSessionId))
    await runtime.prompt({
      agentId: 'agent-performance',
      sessionId: newSessionId,
      content: 'after restart',
    })
    await runtime.drain()
    expect(doneCounts.get(newSessionId)).toBe(1)
  }, 15_000)

  it('reopens the same database after a clean full application restart', async () => {
    closeDatabase()
    app = await startApp({
      host: '127.0.0.1',
      port: 0,
      dataDir: tmp,
      runtime: 'web',
      dataWorkerMode: 'worker',
      realtimeMode: 'embedded',
      runtimeMode: 'embedded',
    })
    await app.stop()
    app = undefined

    app = await startApp({
      host: '127.0.0.1',
      port: 0,
      dataDir: tmp,
      runtime: 'web',
      dataWorkerMode: 'worker',
      realtimeMode: 'embedded',
      runtimeMode: 'embedded',
    })
    const response = await fetch(`${httpBase(app)}/api/v1/tasks`)
    expect(response.status).toBe(200)
  }, 15_000)
})

function startRealtime(): Promise<RealtimeProcessHandle> {
  return createRealtimeProcess({
    host: '127.0.0.1',
    port: 0,
    restartDelayMs: 10,
    authenticate: async () => ({ authMode: 'owner' }),
    dispatchLegacyRpc: async ({ state }) => state.subscriptions,
  })
}

class SocketProbe {
  private readonly messages: ServerMessage[] = []

  constructor(readonly socket: WebSocket) {
    socket.on('message', (raw) => this.messages.push(JSON.parse(raw.toString()) as ServerMessage))
  }

  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(message))
  }

  async next(type: ServerMessage['type'], timeoutMs = 5_000): Promise<ServerMessage> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const index = this.messages.findIndex((message) => message.type === type)
      if (index >= 0) return this.messages.splice(index, 1)[0]
      await delay(5)
    }
    throw new Error(`Timed out waiting for ${type}`)
  }
}

async function connect(url: string): Promise<SocketProbe> {
  const socket = new WebSocket(url)
  await new Promise<void>((resolveOpen, reject) => {
    socket.once('open', resolveOpen)
    socket.once('error', reject)
  })
  return new SocketProbe(socket)
}

function snapshot(sessionId: string): RuntimeStateSnapshot {
  return {
    agent: {
      id: 'agent-performance',
      name: 'Performance Agent',
      type: 'developer',
      runtime: 'mock',
      permissionLevel: 3,
      config: {},
      systemPrompt: '',
      projectId: null,
    },
    session: {
      id: sessionId,
      agentId: 'agent-performance',
      taskId: null,
      projectId: null,
      cwd: process.cwd(),
      title: null,
      acpSessionId: null,
      isPrimary: false,
    },
    runtime: { env: {} },
    runtimePreferences: {},
    mcpServers: [],
    autoApprovedToolNames: [],
  }
}

function httpBase(handle: AppHandle): string {
  const address = handle.server.address()
  if (!address || typeof address === 'string') throw new Error('HTTP server is not listening')
  return `http://127.0.0.1:${address.port}`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}
