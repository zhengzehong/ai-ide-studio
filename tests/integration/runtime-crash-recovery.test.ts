import { afterEach, describe, expect, test } from 'vitest'
import WebSocket from 'ws'
import { createRealtimeProcess, type RealtimeProcessHandle } from '../../src/realtime/process-client.js'
import { createProcessRuntimePort, type ProcessRuntimePort } from '../../src/runtime/api/process-runtime-port.js'
import type { RuntimeStateSnapshot } from '../../src/ports/runtime-port.js'

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

describe('Runtime crash recovery', () => {
  test('keeps Realtime alive, restarts Runtime, and accepts a fresh prompt', async () => {
    realtime = await createRealtimeProcess({
      host: '127.0.0.1',
      port: 0,
      authenticate: async () => ({ authMode: 'owner' }),
      dispatchLegacyRpc: async ({ state }) => state.subscriptions,
    })
    runtime = await createProcessRuntimePort({
      realtimeStreamEndpoint: realtime.runtimeStreamEndpoint,
      realtimeStreamToken: realtime.runtimeStreamToken,
      onPersistenceUpdate: async () => undefined,
      onDone: async () => undefined,
      restartDelayMs: 10,
    })
    socket = await connect(realtime.endpointUrl)
    await runtime.ensureSession(snapshot())
    const interrupted = runtime.prompt({ agentId: 'agent-a', sessionId: 'session-a', content: 'x'.repeat(200) })
    const interruptedResult = expect(interrupted).rejects.toThrow('Runtime process exited')
    await delay(10)
    const previousGeneration = runtime.generation

    await runtime.terminateForTest()
    await interruptedResult
    socket.send(JSON.stringify({ type: 'ping', timestamp: 123 }))
    await expect(nextMessage(socket, 'pong')).resolves.toMatchObject({ timestamp: 123 })
    await runtime.waitForRestart(previousGeneration, 5_000)

    await runtime.ensureSession(snapshot())
    await expect(runtime.prompt({ agentId: 'agent-a', sessionId: 'session-a', content: 'after restart' }))
      .resolves.toBeUndefined()
    expect(runtime.generation).toBeGreaterThan(previousGeneration)
  }, 15_000)
})

function snapshot(): RuntimeStateSnapshot {
  return {
    agent: { id: 'agent-a', name: 'Agent', type: 'developer', runtime: 'mock', permissionLevel: 3, config: {}, systemPrompt: '', projectId: null },
    session: { id: 'session-a', agentId: 'agent-a', taskId: null, projectId: null, cwd: process.cwd(), title: null, acpSessionId: null, isPrimary: false },
    runtime: { env: {} },
    runtimePreferences: {},
    mcpServers: [],
    autoApprovedToolNames: [],
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(url)
    client.once('open', () => resolve(client))
    client.once('error', reject)
  })
}

function nextMessage(client: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 3_000)
    const onMessage = (raw: WebSocket.RawData): void => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>
      if (message.type !== type) return
      clearTimeout(timer)
      client.off('message', onMessage)
      resolve(message)
    }
    client.on('message', onMessage)
  })
}
