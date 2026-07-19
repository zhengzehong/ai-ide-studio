import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createWorkerQueryPort, type WorkerQueryPort } from '../../src/queries/worker-query-port.js'
import { createRealtimeProcess, type RealtimeProcessHandle } from '../../src/realtime/process-client.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import type { ServerMessage } from '../../src/types/ws-protocol.js'

let tmp: string
let dbPath: string
let query: WorkerQueryPort | undefined
let realtime: RealtimeProcessHandle | undefined
let socket: WebSocket | undefined

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-phase-5-performance-'))
  dbPath = resolve(tmp, 'ai-ide.sqlite')
  initDatabase(dbPath)
})

afterEach(async () => {
  socket?.close()
  socket = undefined
  await realtime?.close()
  realtime = undefined
  await query?.close()
  query = undefined
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('Phase 5 performance gates', () => {
  it('loads thirty Session histories below 100ms p95', async () => {
    const sessionIds = Array.from({ length: 30 }, (_, index) => {
      const session = sessionStore.create({ agentId: `agent-history-${index}` })
      for (let messageIndex = 0; messageIndex < 40; messageIndex += 1) {
        messageStore.append(session.id, {
          role: messageIndex % 2 === 0 ? 'user' : 'agent',
          content: `session ${index} message ${messageIndex}`,
        })
      }
      return session.id
    })
    closeDatabase()
    query = await createWorkerQueryPort({ dbPath })

    const latencies = await Promise.all(
      sessionIds.map(async (sessionId) => {
        const startedAt = performance.now()
        const page = await query?.listSessionMessages({ sessionId, limit: 40 })
        expect(page?.items).toHaveLength(40)
        return performance.now() - startedAt
      }),
    )

    expect(percentile(latencies, 0.95)).toBeLessThan(100)
  }, 15_000)

  it('keeps Realtime p95 below 50ms and p99 below 20ms during a two-second Query block', async () => {
    closeDatabase()
    query = await createWorkerQueryPort({ dbPath, allowDiagnostics: true, defaultTimeoutMs: 5_000 })
    realtime = await createRealtimeProcess({
      host: '127.0.0.1',
      port: 0,
      authenticate: async () => ({ authMode: 'owner' }),
      dispatchLegacyRpc: async ({ state }) => state.subscriptions,
    })
    socket = await connect(realtime.endpointUrl)
    const probe = new PingProbe(socket)
    const queryStartedAt = performance.now()
    const blockedQuery = query.diagnose(
      { label: 'two-second-block', blockMs: 2_000 },
      {
        priority: 'background',
      },
    )
    await delay(50)

    const latencies: number[] = []
    for (let index = 0; index < 50; index += 1) latencies.push(await probe.ping(index))
    await blockedQuery

    expect(performance.now() - queryStartedAt).toBeGreaterThanOrEqual(1_900)
    expect(percentile(latencies, 0.95)).toBeLessThan(50)
    expect(percentile(latencies, 0.99)).toBeLessThan(20)
  }, 10_000)
})

class PingProbe {
  private readonly received = new Map<number, number>()

  constructor(private readonly socket: WebSocket) {
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage
      if (message.type === 'pong') this.received.set(message.timestamp, performance.now())
    })
  }

  async ping(timestamp: number): Promise<number> {
    const startedAt = performance.now()
    this.socket.send(JSON.stringify({ type: 'ping', timestamp }))
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline) {
      const receivedAt = this.received.get(timestamp)
      if (receivedAt !== undefined) {
        this.received.delete(timestamp)
        return receivedAt - startedAt
      }
      await delay(1)
    }
    throw new Error(`Timed out waiting for pong ${timestamp}`)
  }
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolveOpen, reject) => {
    const client = new WebSocket(url)
    client.once('open', () => resolveOpen(client))
    client.once('error', reject)
  })
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}
