import { afterEach, describe, expect, test } from 'vitest'
import WebSocket from 'ws'
import { createRealtimeProcess, type RealtimeProcessHandle } from '../../src/realtime/process-client.js'
import { createProcessRuntimePort, type ProcessRuntimePort } from '../../src/runtime/api/process-runtime-port.js'
import type { RuntimeStateSnapshot } from '../../src/ports/runtime-port.js'
import type { ServerMessage } from '../../src/types/ws-protocol.js'

let realtime: RealtimeProcessHandle | undefined
let runtime: ProcessRuntimePort | undefined
const sockets: WebSocket[] = []

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close()
  await runtime?.close()
  runtime = undefined
  await realtime?.close()
  realtime = undefined
})

describe('Runtime direct Realtime stream', () => {
  test('streams cursored patches directly and waits for the API done barrier', async () => {
    realtime = await createRealtimeProcess({
      host: '127.0.0.1',
      port: 0,
      authenticate: async () => ({ authMode: 'owner' }),
      dispatchLegacyRpc: async ({ state }) => state.subscriptions,
    })
    const client = await connect(realtime.endpointUrl)
    sockets.push(client.socket)
    client.send({ type: 'subscribe', requestId: 'subscribe-a', sessionIds: ['session-a'] })
    await client.next('result')

    let releaseDone: (() => void) | undefined
    let doneReached: (() => void) | undefined
    const doneGate = new Promise<void>((resolve) => { releaseDone = resolve })
    const atDone = new Promise<void>((resolve) => { doneReached = resolve })
    runtime = await createProcessRuntimePort({
      realtimeStreamEndpoint: realtime.runtimeStreamEndpoint,
      realtimeStreamToken: realtime.runtimeStreamToken,
      onPersistenceUpdate: async () => undefined,
      onDone: async (done) => {
        doneReached?.()
        await doneGate
        await realtime?.sendDelivery({
          scope: 'session',
          sessionId: done.sessionId,
          message: {
            type: 'session:done',
            sessionId: done.sessionId,
            agentId: done.agentId,
            messageId: done.messageId,
            streamGeneration: done.streamGeneration,
            sequence: done.sequence,
          },
        })
      },
    })

    await runtime.ensureSession(snapshot('session-a'))
    const prompt = runtime.prompt({ agentId: 'agent-a', sessionId: 'session-a', content: 'hello direct stream' })
    const first = await client.next('session:update') as Extract<ServerMessage, { type: 'session:update' }>
    expect(first.streamGeneration).toEqual(expect.any(String))
    expect(first.sequence).toBeGreaterThan(0)

    await atDone
    await expect(client.none('session:done', 75)).resolves.toBe(true)
    releaseDone?.()
    await prompt
    const done = await client.next('session:done') as Extract<ServerMessage, { type: 'session:done' }>
    expect(done.streamGeneration).toBe(first.streamGeneration)
    expect(done.sequence).toBeGreaterThanOrEqual(first.sequence ?? 0)
  }, 15_000)

  test('keeps the stream contiguous when persistence overlaps later UI updates', async () => {
    realtime = await createRealtimeProcess({
      host: '127.0.0.1',
      port: 0,
      authenticate: async () => ({ authMode: 'owner' }),
      dispatchLegacyRpc: async ({ state }) => state.subscriptions,
    })
    const client = await connect(realtime.endpointUrl)
    sockets.push(client.socket)
    client.send({ type: 'subscribe', requestId: 'subscribe-overlap', sessionIds: ['session-overlap'] })
    await client.next('result')

    runtime = await createProcessRuntimePort({
      realtimeStreamEndpoint: realtime.runtimeStreamEndpoint,
      realtimeStreamToken: realtime.runtimeStreamToken,
      onPersistenceUpdate: async () => { await delay(400) },
      onDone: async (done) => {
        await realtime?.sendDelivery({
          scope: 'session',
          sessionId: done.sessionId,
          message: {
            type: 'session:done',
            sessionId: done.sessionId,
            agentId: done.agentId,
            messageId: done.messageId,
            streamGeneration: done.streamGeneration,
            sequence: done.sequence,
          },
        })
      },
    })

    await runtime.ensureSession(snapshot('session-overlap'))
    await runtime.prompt({
      agentId: 'agent-a',
      sessionId: 'session-overlap',
      content: 'x'.repeat(800),
    })

    const messages = await client.until('session:done')
    expect(messages.some((message) => message.type === 'resync_required')).toBe(false)
    const cursors = messages.flatMap((message) => {
      if (!('sequence' in message) || typeof message.sequence !== 'number') return []
      return [message.sequence]
    })
    expect(cursors).toEqual([...cursors].sort((left, right) => left - right))
  }, 20_000)

  test('keeps queued persistence batches bound to distinct UI cursors', async () => {
    realtime = await createRealtimeProcess({
      host: '127.0.0.1',
      port: 0,
      authenticate: async () => ({ authMode: 'owner' }),
      dispatchLegacyRpc: async ({ state }) => state.subscriptions,
    })
    const client = await connect(realtime.endpointUrl)
    sockets.push(client.socket)
    client.send({ type: 'subscribe', requestId: 'subscribe-queued', sessionIds: ['session-queued'] })
    await client.next('result')

    let releaseFirstPersistence: (() => void) | undefined
    const firstPersistenceGate = new Promise<void>((resolve) => { releaseFirstPersistence = resolve })
    let persistenceCount = 0
    runtime = await createProcessRuntimePort({
      realtimeStreamEndpoint: realtime.runtimeStreamEndpoint,
      realtimeStreamToken: realtime.runtimeStreamToken,
      onPersistenceUpdate: async () => {
        persistenceCount += 1
        if (persistenceCount === 1) await firstPersistenceGate
      },
      onDone: async (done) => {
        await realtime?.sendDelivery({
          scope: 'session',
          sessionId: done.sessionId,
          message: {
            type: 'session:done',
            sessionId: done.sessionId,
            agentId: done.agentId,
            messageId: done.messageId,
            streamGeneration: done.streamGeneration,
            sequence: done.sequence,
          },
        })
      },
    })

    await runtime.ensureSession(snapshot('session-queued'))
    const prompt = runtime.prompt({
      agentId: 'agent-a',
      sessionId: 'session-queued',
      content: 'x'.repeat(800),
    })
    await delay(1_000)
    releaseFirstPersistence?.()
    await prompt

    expect(persistenceCount).toBeGreaterThanOrEqual(3)
    const messages = await client.until('session:done')
    expect(messages.some((message) => message.type === 'resync_required')).toBe(false)
  }, 20_000)
})

class SocketProbe {
  private readonly received: ServerMessage[] = []

  constructor(readonly socket: WebSocket) {
    socket.on('message', (raw) => this.received.push(JSON.parse(raw.toString()) as ServerMessage))
  }

  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(message))
  }

  async next(type: ServerMessage['type']): Promise<ServerMessage> {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      const index = this.received.findIndex((message) => message.type === type)
      if (index >= 0) return this.received.splice(index, 1)[0]
      await delay(10)
    }
    throw new Error(`Timed out waiting for ${type}`)
  }

  async none(type: ServerMessage['type'], waitMs: number): Promise<boolean> {
    await delay(waitMs)
    return !this.received.some((message) => message.type === type)
  }

  async until(type: ServerMessage['type']): Promise<ServerMessage[]> {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      const index = this.received.findIndex((message) => message.type === type)
      if (index >= 0) return this.received.splice(0, index + 1)
      await delay(10)
    }
    throw new Error(`Timed out waiting for ${type}`)
  }
}

async function connect(url: string): Promise<SocketProbe> {
  const socket = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return new SocketProbe(socket)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function snapshot(sessionId: string): RuntimeStateSnapshot {
  return {
    agent: {
      id: 'agent-a',
      name: 'Runtime Agent',
      type: 'developer',
      runtime: 'mock',
      permissionLevel: 3,
      config: {},
      systemPrompt: '',
      projectId: 'project-a',
    },
    session: {
      id: sessionId,
      agentId: 'agent-a',
      taskId: null,
      projectId: 'project-a',
      cwd: process.cwd(),
      title: sessionId,
      acpSessionId: null,
      isPrimary: false,
    },
    runtime: { env: {} },
    runtimePreferences: {},
    mcpServers: [],
    autoApprovedToolNames: [],
  }
}
