import { performance } from 'node:perf_hooks'
import { afterEach, describe, expect, test } from 'vitest'
import WebSocket from 'ws'
import type { RuntimeStateSnapshot } from '../../src/ports/runtime-port.js'
import { createRealtimeProcess, type RealtimeProcessHandle } from '../../src/realtime/process-client.js'
import { createProcessRuntimePort, type ProcessRuntimePort } from '../../src/runtime/api/process-runtime-port.js'
import type { ServerMessage } from '../../src/types/ws-protocol.js'

let realtime: RealtimeProcessHandle | undefined
let runtime: ProcessRuntimePort | undefined
let socket: WebSocket | undefined

afterEach(async () => {
  socket?.close()
  socket = undefined
  await runtime?.close()
  runtime = undefined
  await realtime?.close()
  realtime = undefined
})

describe('Runtime process performance', () => {
  test('streams thirty Sessions concurrently and commits one done per Session', async () => {
    realtime = await createRealtimeProcess({
      host: '127.0.0.1',
      port: 0,
      authenticate: async () => ({ authMode: 'owner' }),
      dispatchLegacyRpc: async ({ state }) => state.subscriptions,
    })
    const doneCounts = new Map<string, number>()
    runtime = await createProcessRuntimePort({
      realtimeStreamEndpoint: realtime.runtimeStreamEndpoint,
      realtimeStreamToken: realtime.runtimeStreamToken,
      onPersistenceUpdate: async () => undefined,
      onDone: async (event) => {
        doneCounts.set(event.sessionId, (doneCounts.get(event.sessionId) ?? 0) + 1)
      },
    })
    const sessionIds = Array.from({ length: 30 }, (_, index) => `session-${index}`)
    await Promise.all(sessionIds.map((sessionId) => runtime?.ensureSession(snapshot(sessionId))))

    socket = await connect(realtime.endpointUrl)
    const probe = new LatencyProbe(socket)
    socket.send(JSON.stringify({ type: 'subscribe', requestId: 'all', sessionIds }))
    await probe.waitFor('result')
    const startedAt = new Map(sessionIds.map((sessionId) => [sessionId, performance.now()]))
    const prompts = sessionIds.map((sessionId) => runtime?.prompt({
      agentId: 'agent-performance',
      sessionId,
      content: `hello ${sessionId}`,
    }))

    const latencies = await probe.firstUpdateLatencies(startedAt)
    await Promise.all(prompts)
    await runtime.drain()

    expect(percentile(latencies, 0.95)).toBeLessThan(100)
    expect([...doneCounts.values()]).toHaveLength(30)
    expect([...doneCounts.values()].every((count) => count === 1)).toBe(true)
  }, 20_000)
})

class LatencyProbe {
  private readonly messages: ServerMessage[] = []

  constructor(socket: WebSocket) {
    socket.on('message', (raw) => this.messages.push(JSON.parse(raw.toString()) as ServerMessage))
  }

  async waitFor(type: ServerMessage['type']): Promise<void> {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      if (this.messages.some((message) => message.type === type)) return
      await delay(5)
    }
    throw new Error(`Timed out waiting for ${type}`)
  }

  async firstUpdateLatencies(startedAt: Map<string, number>): Promise<number[]> {
    const first = new Map<string, number>()
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && first.size < startedAt.size) {
      for (const message of this.messages.splice(0)) {
        if (message.type !== 'session:update' || first.has(message.sessionId)) continue
        first.set(message.sessionId, performance.now() - (startedAt.get(message.sessionId) ?? performance.now()))
      }
      await delay(2)
    }
    if (first.size !== startedAt.size) throw new Error(`Expected ${startedAt.size} streams, received ${first.size}`)
    return [...first.values()]
  }
}

function snapshot(sessionId: string): RuntimeStateSnapshot {
  return {
    agent: { id: 'agent-performance', name: 'Performance Agent', type: 'developer', runtime: 'mock', permissionLevel: 3, config: {}, systemPrompt: '', projectId: null },
    session: { id: sessionId, agentId: 'agent-performance', taskId: null, projectId: null, cwd: process.cwd(), title: null, acpSessionId: null, isPrimary: false },
    runtime: { env: {} },
    runtimePreferences: {},
    mcpServers: [],
    autoApprovedToolNames: [],
  }
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(url)
    client.once('open', () => resolve(client))
    client.once('error', reject)
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
