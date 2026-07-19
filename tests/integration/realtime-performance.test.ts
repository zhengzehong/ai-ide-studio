import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Server } from 'node:http'
import { performance } from 'node:perf_hooks'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { startGateway } from '../../src/gateway/server.js'
import type { QueryPort } from '../../src/ports/query-port.js'
import {
  createRealtimeProcess,
  type RealtimeProcessHandle,
} from '../../src/realtime/process-client.js'
import type { ServerMessage } from '../../src/types/ws-protocol.js'

let realtime: RealtimeProcessHandle | undefined
let gateway: Server | undefined
const sockets: WebSocket[] = []
const probes: ChildProcessWithoutNullStreams[] = []

afterEach(async () => {
  for (const probe of probes.splice(0)) probe.kill()
  for (const socket of sockets.splice(0)) socket.close()
  await realtime?.close()
  realtime = undefined
  if (gateway) await closeServer(gateway)
  gateway = undefined
})

describe('Realtime process performance and isolation', () => {
  it('delivers 30 isolated streams below 50ms p95', async () => {
    realtime = await startRealtime()
    const clients = await Promise.all(Array.from({ length: 30 }, async (_, index) => {
      const client = await connect(`${realtime?.endpointUrl}?token=owner`)
      sockets.push(client.socket)
      const sessionId = `session-${index}`
      client.send({ type: 'subscribe', requestId: sessionId, sessionIds: [sessionId] })
      await client.next('result', sessionId)
      return { client, sessionId }
    }))

    const latencies = await Promise.all(clients.map(async ({ client, sessionId }, index) => {
      const startedAt = performance.now()
      const received = client.next('session:update')
      await realtime?.sendDelivery({
        scope: 'session',
        sessionId,
        message: update(sessionId, `message-${index}`, 'chunk'),
      })
      await received
      return performance.now() - startedAt
    }))

    expect(percentile(latencies, 0.95)).toBeLessThan(50)
  }, 15_000)

  it('bounds a stalled client without delaying a healthy client or losing done', async () => {
    realtime = await startRealtime({
      maxQueueMessages: 8,
      maxQueueBytes: 64 * 1024,
      maxBufferedBytes: 4 * 1024,
      flushIntervalMs: 1,
    })
    const healthy = await connect(`${realtime.endpointUrl}?token=owner`)
    const stalled = await connect(`${realtime.endpointUrl}?token=owner`)
    sockets.push(healthy.socket, stalled.socket)
    for (const [requestId, client] of [['healthy', healthy], ['stalled', stalled]] as const) {
      client.send({ type: 'subscribe', requestId, sessionIds: ['session-shared'] })
      await client.next('result', requestId)
    }

    stalled.pause()
    const payload = 'x'.repeat(32 * 1024)
    for (let index = 0; index < 512; index += 1) {
      await realtime.sendDelivery({
        scope: 'session',
        sessionId: 'session-shared',
        message: update('session-shared', 'message-stream', payload),
      })
    }
    const healthyDone = healthy.next('session:done')
    await realtime.sendDelivery({
      scope: 'session',
      sessionId: 'session-shared',
      message: done('session-shared'),
    })

    await healthyDone
    stalled.resume()
    await stalled.next('resync_required', undefined, 5_000)
    await stalled.next('session:done', undefined, 5_000)
  }, 20_000)

  it('keeps local realtime control responsive while the API event loop blocks for 150ms', async () => {
    realtime = await startRealtime()
    const probe = startPingProbe(`${realtime.endpointUrl}?token=owner`)
    probes.push(probe.process)
    await probe.ready

    probe.ping()
    blockEventLoop(150)
    const elapsedMs = await probe.elapsed

    expect(elapsedMs).toBeLessThan(50)
  }, 10_000)

  it('keeps HTTP Query available while realtime restarts', async () => {
    realtime = await startRealtime({ restartDelayMs: 10 })
    const gatewayHandle = await startGateway({
      host: '127.0.0.1',
      port: 0,
      dataDir: '.',
      runtime: 'web',
      localToken: 'query-token',
    }, {
      queryPort: emptyQueryPort(),
      webSocketMode: 'none',
      realtimeState: () => ({
        mode: 'process',
        host: '127.0.0.1',
        port: realtime?.port ?? 0,
        legacyRpcEnabled: true,
      }),
    })
    gateway = gatewayHandle.server
    const previousGeneration = realtime.generation

    await realtime.terminateForTest()
    const responseDuringRestart = await fetch(`${httpBase(gateway)}/api/v1/tasks`, {
      headers: { 'x-ai-ide-token': 'query-token' },
    })
    await realtime.waitForRestart(previousGeneration)
    const discoveryAfterRestart = await fetch(`${httpBase(gateway)}/api/v1/realtime-config`)

    expect(responseDuringRestart.status).toBe(200)
    await expect(responseDuringRestart.json()).resolves.toEqual({ data: [] })
    await expect(discoveryAfterRestart.json()).resolves.toMatchObject({
      wsUrl: realtime.endpointUrl,
    })
  }, 10_000)
})

interface RealtimeOverrides {
  maxQueueMessages?: number
  maxQueueBytes?: number
  maxBufferedBytes?: number
  flushIntervalMs?: number
  restartDelayMs?: number
}

function startRealtime(overrides: RealtimeOverrides = {}): Promise<RealtimeProcessHandle> {
  return createRealtimeProcess({
    host: '127.0.0.1',
    port: 0,
    authenticate: async (request) => request.token === 'owner' ? { authMode: 'owner' } : undefined,
    dispatchLegacyRpc: async ({ state }) => state.subscriptions,
    ...overrides,
  })
}

class SocketProbe {
  private readonly received: ServerMessage[] = []
  private readonly waiters = new Set<() => void>()
  private readonly transport: { pause(): void; resume(): void }

  constructor(readonly socket: WebSocket) {
    this.transport = (socket as WebSocket & { _socket: { pause(): void; resume(): void } })._socket
    socket.on('message', (raw) => {
      this.received.push(JSON.parse(raw.toString()) as ServerMessage)
      for (const wake of this.waiters) wake()
      this.waiters.clear()
    })
  }

  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(message))
  }

  pause(): void {
    this.transport.pause()
  }

  resume(): void {
    this.transport.resume()
  }

  async next(type: ServerMessage['type'], requestId?: string, timeoutMs = 3_000): Promise<ServerMessage> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const index = this.received.findIndex((message) => (
        message.type === type && (requestId === undefined
          || ('requestId' in message && message.requestId === requestId))
      ))
      if (index >= 0) return this.received.splice(index, 1)[0]
      await new Promise<void>((resolveWait) => {
        const timer = setTimeout(() => {
          this.waiters.delete(wake)
          resolveWait()
        }, 25)
        const wake = (): void => {
          clearTimeout(timer)
          resolveWait()
        }
        this.waiters.add(wake)
      })
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

function update(sessionId: string, messageId: string, contentDelta: string): ServerMessage {
  return {
    type: 'session:update',
    sessionId,
    agentId: 'agent-performance',
    data: { messageId, role: 'agent', contentDelta },
  }
}

function done(sessionId: string): ServerMessage {
  return {
    type: 'session:done',
    sessionId,
    agentId: 'agent-performance',
    messageId: 'message-stream',
  }
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]
}

function blockEventLoop(durationMs: number): void {
  const deadline = performance.now() + durationMs
  while (performance.now() < deadline) {
    // Intentional synchronous diagnostic block.
  }
}

function startPingProbe(url: string): {
  process: ChildProcessWithoutNullStreams
  ready: Promise<void>
  ping: () => void
  elapsed: Promise<number>
} {
  const script = [
    "import WebSocket from 'ws'",
    'const socket = new WebSocket(process.argv[1])',
    "process.stdin.setEncoding('utf8')",
    "socket.once('open', () => process.stdout.write('READY\\n'))",
    "process.stdin.on('data', (chunk) => { if (chunk.includes('PING')) { globalThis.started = performance.now(); socket.send(JSON.stringify({ type: 'ping', timestamp: 1 })) } })",
    "socket.on('message', (raw) => { const message = JSON.parse(raw.toString()); if (message.type === 'pong') process.stdout.write(`ELAPSED ${performance.now() - globalThis.started}\\n`) })",
  ].join(';')
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, url], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const lines = lineStream(child)
  return {
    process: child,
    ready: lines.next('READY').then(() => undefined),
    ping: () => child.stdin.write('PING\n'),
    elapsed: lines.next('ELAPSED').then((line) => Number(line.slice('ELAPSED '.length))),
  }
}

function lineStream(child: ChildProcessWithoutNullStreams): { next(prefix: string): Promise<string> } {
  let buffered = ''
  const lines: string[] = []
  const waiters = new Set<() => void>()
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffered += chunk
    const parts = buffered.split('\n')
    buffered = parts.pop() ?? ''
    lines.push(...parts)
    for (const wake of waiters) wake()
    waiters.clear()
  })
  return {
    async next(prefix: string): Promise<string> {
      const deadline = Date.now() + 5_000
      while (Date.now() < deadline) {
        const index = lines.findIndex((line) => line.startsWith(prefix))
        if (index >= 0) return lines.splice(index, 1)[0]
        await new Promise<void>((resolveWait) => {
          const wake = (): void => resolveWait()
          waiters.add(wake)
          setTimeout(() => { waiters.delete(wake); resolveWait() }, 25)
        })
      }
      throw new Error(`Timed out waiting for probe output: ${prefix}`)
    },
  }
}

function emptyQueryPort(): QueryPort {
  return {
    async listTasks() { return [] },
    async listSessions() { return [] },
    async listSessionMessages() { return { items: [], hasMore: false, nextCursor: null } },
    async listSessionEvents() { return { items: [], hasMore: false, nextCursor: null } },
  }
}

function httpBase(server: Server): string {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('HTTP server is not listening')
  return `http://127.0.0.1:${address.port}`
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
}
