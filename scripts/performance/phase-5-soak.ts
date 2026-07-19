import { performance } from 'node:perf_hooks'
import WebSocket from 'ws'
import type { RuntimeStateSnapshot } from '../../src/ports/runtime-port.js'
import { createRealtimeProcess } from '../../src/realtime/process-client.js'
import { createProcessRuntimePort } from '../../src/runtime/api/process-runtime-port.js'
import type { ServerMessage } from '../../src/types/ws-protocol.js'

interface SoakOptions {
  sessions: number
  durationMs: number
  sampleMs: number
  json: boolean
}

interface SoakResult {
  sessions: number
  durationMs: number
  waves: number
  prompts: number
  doneEvents: number
  duplicateDoneEvents: number
  timedOutWaves: number
  runtimeEventP95Ms: number
  runtimeEventP99Ms: number
  heapSamples: number[]
  heapGrowthBytesPerMinute: number | null
  heapGrowthEvaluated: boolean
  passed: boolean
}

const DEFAULT_SESSIONS = 30
const DEFAULT_DURATION_MS = 30 * 60 * 1000
const DEFAULT_SAMPLE_MS = 1_000
const MAX_HEAP_GROWTH_BYTES_PER_MINUTE = 5 * 1024 * 1024

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  const realtime = await createRealtimeProcess({
    host: '127.0.0.1',
    port: 0,
    authenticate: async () => ({ authMode: 'owner' }),
    dispatchLegacyRpc: async ({ state }) => state.subscriptions,
  })
  const doneCounts = new Map<string, number>()
  const runtime = await createProcessRuntimePort({
    realtimeStreamEndpoint: realtime.runtimeStreamEndpoint,
    realtimeStreamToken: realtime.runtimeStreamToken,
    onPersistenceUpdate: async () => undefined,
    onDone: async (event) => {
      doneCounts.set(event.sessionId, (doneCounts.get(event.sessionId) ?? 0) + 1)
      await realtime.sendDelivery({
        scope: 'session',
        sessionId: event.sessionId,
        message: {
          type: 'session:done',
          sessionId: event.sessionId,
          agentId: event.agentId,
          messageId: event.messageId,
          streamGeneration: event.streamGeneration,
          sequence: event.sequence,
        },
      })
    },
  })
  const sessionIds = Array.from({ length: options.sessions }, (_, index) => `soak-session-${index}`)
  await Promise.all(sessionIds.map((sessionId) => runtime.ensureSession(snapshot(sessionId))))
  const socket = await connect(realtime.endpointUrl)
  const probe = new StreamProbe(socket)
  socket.send(JSON.stringify({ type: 'subscribe', requestId: 'soak', sessionIds }))
  await probe.waitFor('result')

  const startedAt = Date.now()
  const deadline = startedAt + options.durationMs
  const latencies: number[] = []
  const heapSamples: number[] = []
  let waves = 0
  let timedOutWaves = 0
  try {
    do {
      const waveStarted = new Map(sessionIds.map((sessionId) => [sessionId, performance.now()]))
      probe.beginWave(waveStarted)
      const previousDone = new Map(doneCounts)
      const prompts = sessionIds.map((sessionId) =>
        runtime.prompt({
          agentId: 'agent-soak',
          sessionId,
          content: `soak wave ${waves} for ${sessionId}`,
        }),
      )
      try {
        const firstUpdates = await withTimeout(
          probe.waitForWave(),
          10_000,
          () => `Runtime update wave timed out: ${probe.diagnostics()}`,
        )
        latencies.push(...firstUpdates)
        await withTimeout(Promise.all(prompts), 20_000, 'Runtime prompt wave timed out')
        await runtime.drain()
      } catch (error) {
        timedOutWaves += 1
        throw error
      }
      for (const sessionId of sessionIds) {
        const expected = (previousDone.get(sessionId) ?? 0) + 1
        if (doneCounts.get(sessionId) !== expected) {
          throw new Error(`Expected one done for ${sessionId} in wave ${waves}`)
        }
      }
      waves += 1
      heapSamples.push(process.memoryUsage().heapUsed)
      const remaining = deadline - Date.now()
      if (remaining > 0) await delay(Math.min(options.sampleMs, remaining))
    } while (Date.now() < deadline || waves === 0)
  } finally {
    socket.close()
    await runtime.close()
    await realtime.close()
  }

  const doneEvents = [...doneCounts.values()].reduce((sum, count) => sum + count, 0)
  const expectedDone = waves * sessionIds.length
  const duplicateDoneEvents = Math.max(0, doneEvents - expectedDone)
  const stableHeapSamples = heapSamples.slice(Math.min(2, Math.max(0, heapSamples.length - 2)))
  const heapGrowthBytesPerMinute =
    stableHeapSamples.length >= 2 ? linearSlope(stableHeapSamples) * (60_000 / options.sampleMs) : null
  const heapGrowthEvaluated = options.durationMs >= 60_000 && stableHeapSamples.length >= 6
  const result: SoakResult = {
    sessions: options.sessions,
    durationMs: Date.now() - startedAt,
    waves,
    prompts: expectedDone,
    doneEvents,
    duplicateDoneEvents,
    timedOutWaves,
    runtimeEventP95Ms: percentile(latencies, 0.95),
    runtimeEventP99Ms: percentile(latencies, 0.99),
    heapSamples,
    heapGrowthBytesPerMinute,
    heapGrowthEvaluated,
    passed:
      timedOutWaves === 0 &&
      doneEvents === expectedDone &&
      duplicateDoneEvents === 0 &&
      percentile(latencies, 0.95) < 50 &&
      (!heapGrowthEvaluated ||
        (heapGrowthBytesPerMinute ?? Number.POSITIVE_INFINITY) <= MAX_HEAP_GROWTH_BYTES_PER_MINUTE),
  }
  writeResult(result, options.json)
  if (!result.passed) process.exitCode = 1
}

class StreamProbe {
  private readonly messages: ServerMessage[] = []
  private readonly messageCounts = new Map<string, number>()
  private readonly updateSessionIds = new Set<string>()
  private startedAt = new Map<string, number>()
  private readonly firstSessionIds = new Set<string>()

  constructor(socket: WebSocket) {
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage
      this.messages.push(message)
      this.messageCounts.set(message.type, (this.messageCounts.get(message.type) ?? 0) + 1)
      if (message.type === 'session:update') this.updateSessionIds.add(message.sessionId)
    })
  }

  beginWave(startedAt: Map<string, number>): void {
    this.startedAt = startedAt
    this.firstSessionIds.clear()
  }

  async waitFor(type: ServerMessage['type']): Promise<void> {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      if (this.messages.some((message) => message.type === type)) return
      await delay(2)
    }
    throw new Error(`Timed out waiting for ${type}`)
  }

  async waitForWave(): Promise<number[]> {
    const first = new Map<string, number>()
    while (first.size < this.startedAt.size) {
      for (const message of this.messages.splice(0)) {
        if (message.type !== 'session:update' || first.has(message.sessionId)) continue
        const startedAt = this.startedAt.get(message.sessionId)
        if (startedAt !== undefined) {
          first.set(message.sessionId, performance.now() - startedAt)
          this.firstSessionIds.add(message.sessionId)
        }
      }
      if (first.size < this.startedAt.size) await delay(1)
    }
    return [...first.values()]
  }

  diagnostics(): string {
    const missing = [...this.startedAt.keys()].filter((sessionId) => !this.firstSessionIds.has(sessionId))
    return JSON.stringify({
      messageCounts: Object.fromEntries(this.messageCounts),
      updateSessionIds: [...this.updateSessionIds],
      expectedSessionIds: [...this.startedAt.keys()],
      missing,
    })
  }
}

function parseOptions(args: string[]): SoakOptions {
  const values = new Map<string, string>()
  let json = false
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--json') {
      json = true
      continue
    }
    const value = args[index + 1]
    if (!value) throw new Error(`Missing value for ${args[index]}`)
    values.set(args[index], value)
    index += 1
  }
  return {
    sessions: positiveInteger(values.get('--sessions'), DEFAULT_SESSIONS),
    durationMs: positiveInteger(values.get('--duration-ms'), DEFAULT_DURATION_MS),
    sampleMs: positiveInteger(values.get('--sample-ms'), DEFAULT_SAMPLE_MS),
    json,
  }
}

function snapshot(sessionId: string): RuntimeStateSnapshot {
  return {
    agent: {
      id: 'agent-soak',
      name: 'Soak Agent',
      type: 'developer',
      runtime: 'mock',
      permissionLevel: 3,
      config: {},
      systemPrompt: '',
      projectId: null,
    },
    session: {
      id: sessionId,
      agentId: 'agent-soak',
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

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolveOpen, reject) => {
    const socket = new WebSocket(url)
    socket.once('open', () => resolveOpen(socket))
    socket.once('error', reject)
  })
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]
}

function linearSlope(values: number[]): number {
  const meanX = (values.length - 1) / 2
  const meanY = values.reduce((sum, value) => sum + value, 0) / values.length
  let numerator = 0
  let denominator = 0
  values.forEach((value, index) => {
    numerator += (index - meanX) * (value - meanY)
    denominator += (index - meanX) ** 2
  })
  return denominator > 0 ? numerator / denominator : 0
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Expected a positive integer, received ${value}`)
  return parsed
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string | (() => string)): Promise<T> {
  return Promise.race([
    promise,
    delay(timeoutMs).then(() => {
      throw new Error(typeof message === 'function' ? message() : message)
    }),
  ])
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function writeResult(result: SoakResult, json: boolean): void {
  process.stdout.write(`${json ? JSON.stringify(result) : JSON.stringify(result, null, 2)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
