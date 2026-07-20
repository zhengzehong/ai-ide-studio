import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import {
  startUnifiedService,
  type UnifiedServiceHandle,
} from '../../src/edge/supervisor.js'
import type { ServerMessage } from '../../src/types/ws-protocol.js'

let service: UnifiedServiceHandle | undefined
let dataDir: string | undefined
const sockets: WebSocket[] = []

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close()
  await service?.close()
  service = undefined
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  dataDir = undefined
})

describe('single-port public service', () => {
  it('serves HTTP, legacy RPC, subscriptions, and Session events through one authority', async () => {
    service = await startService()
    const discoveryResponse = await fetch(`${service.endpointUrl}/api/v1/realtime-config`)
    const discovery = await discoveryResponse.json() as Record<string, unknown>

    expect(discoveryResponse.status).toBe(200)
    expect(discovery.wsUrl).toBe(`${service.wsEndpointUrl}/realtime`)
    expect(new URL(String(discovery.wsUrl)).port).toBe(new URL(service.endpointUrl).port)
    await expect(fetch(`${service.endpointUrl}/health`).then((response) => response.json()))
      .resolves.toMatchObject({ status: 'ok' })

    const probe = await connect(String(discovery.wsUrl))
    probe.send({ type: 'ping', timestamp: 1 })
    await expect(probe.next('pong')).resolves.toMatchObject({ timestamp: 1 })
    probe.send({ type: 'projects.list', requestId: 'projects' })
    await expect(probe.next('result', 'projects')).resolves.toMatchObject({ data: [] })

    probe.send({ type: 'sessions.create', requestId: 'create', agentId: 'mock-dev' })
    const created = await probe.next('result', 'create')
    const sessionId = String((created as Extract<ServerMessage, { type: 'result' }>).data
      && ((created as Extract<ServerMessage, { type: 'result' }>).data as Record<string, unknown>).id)
    expect(sessionId).toMatch(/^sess-/)
    probe.send({ type: 'subscribe', requestId: 'subscribe', sessionIds: [sessionId] })
    await probe.next('result', 'subscribe')
    probe.send({ type: 'prompt', requestId: 'prompt', sessionId, content: 'single port event' })

    await expect(probe.next('session:update')).resolves.toMatchObject({ sessionId })
  }, 20_000)

  it('keeps public Realtime responsive while the API event loop is blocked', async () => {
    service = await startService()
    const publicProbe = await connect(`${service.wsEndpointUrl}/realtime`)
    const directProbe = await connect(service.apiTargets.realtimeUrl as string)
    const blocked = service.blockApiForTest(150)
    await delay(25)
    const startedAt = performance.now()

    const publicPong = publicProbe.next('pong').then(() => performance.now() - startedAt)
    const directPong = directProbe.next('pong').then(() => performance.now() - startedAt)
    publicProbe.send({ type: 'ping', timestamp: 2 })
    directProbe.send({ type: 'ping', timestamp: 3 })
    const [publicLatency, directLatency] = await Promise.all([publicPong, directPong])

    expect(
      publicLatency,
      `public=${publicLatency.toFixed(1)}ms direct=${directLatency.toFixed(1)}ms`,
    ).toBeLessThan(50)
    expect(directLatency).toBeLessThan(50)
    await blocked
  })

  it('keeps the public URL stable when Realtime restarts on a new internal port', async () => {
    service = await startService()
    const publicWsUrl = `${service.wsEndpointUrl}/realtime`
    const previousRealtimeUrl = service.apiTargets.realtimeUrl

    await service.restartRealtimeForTest()

    expect(service.apiTargets.realtimeUrl).not.toBe(previousRealtimeUrl)
    const discovery = await fetch(`${service.endpointUrl}/api/v1/realtime-config`).then((response) => response.json())
    expect((discovery as Record<string, unknown>).wsUrl).toBe(publicWsUrl)
    const probe = await connect(publicWsUrl)
    probe.send({ type: 'ping', timestamp: 3 })
    await expect(probe.next('pong')).resolves.toMatchObject({ timestamp: 3 })
  }, 15_000)

  it('returns 503 while API restarts and recovers on the same public port', async () => {
    service = await startService()
    const endpointUrl = service.endpointUrl
    const previousGeneration = service.apiGeneration

    await service.terminateApiForTest()
    const unavailable = await fetch(`${endpointUrl}/health`)

    expect(unavailable.status).toBe(503)
    await service.waitForApiRestart(previousGeneration, 10_000)
    const recovered = await fetch(`${endpointUrl}/health`)
    expect(recovered.status).toBe(200)
    expect(service.endpointUrl).toBe(endpointUrl)
  }, 20_000)

  it('closes the public listener and the owned process tree', async () => {
    service = await startService()
    const endpointUrl = service.endpointUrl

    await service.close()
    service = undefined

    await expect(fetch(`${endpointUrl}/health`)).rejects.toThrow()
  })
})

async function startService(): Promise<UnifiedServiceHandle> {
  dataDir = mkdtempSync(resolve(tmpdir(), 'ai-ide-single-port-'))
  return startUnifiedService({
    host: '127.0.0.1',
    port: 0,
    dataDir,
    runtime: 'web',
    dataWorkerMode: 'local',
    realtimeMode: 'process',
    runtimeMode: 'embedded',
    edgeMode: 'process',
    edgeRealtimePath: '/realtime',
  })
}

class SocketProbe {
  private readonly received: ServerMessage[] = []
  private readonly waiters = new Set<() => void>()

  constructor(readonly socket: WebSocket) {
    socket.on('message', (raw) => {
      this.received.push(JSON.parse(raw.toString()) as ServerMessage)
      for (const wake of this.waiters) wake()
      this.waiters.clear()
    })
  }

  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(message))
  }

  async next(type: ServerMessage['type'], requestId?: string): Promise<ServerMessage> {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      const index = this.received.findIndex((message) => (
        message.type === type
        && (requestId === undefined || ('requestId' in message && message.requestId === requestId))
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
  sockets.push(socket)
  await new Promise<void>((resolveOpen, reject) => {
    socket.once('open', resolveOpen)
    socket.once('error', reject)
  })
  return new SocketProbe(socket)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}
