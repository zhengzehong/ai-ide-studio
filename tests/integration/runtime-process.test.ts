import { afterEach, describe, expect, test } from 'vitest'
import {
  createProcessRuntimePort,
  type ProcessRuntimePort,
  type RuntimePersistenceUpdate,
} from '../../src/runtime/api/process-runtime-port.js'
import { createRealtimeProcess, type RealtimeProcessHandle } from '../../src/realtime/process-client.js'
import type { RuntimeStateSnapshot } from '../../src/ports/runtime-port.js'

let realtime: RealtimeProcessHandle | undefined
let runtime: ProcessRuntimePort | undefined

afterEach(async () => {
  await runtime?.close()
  runtime = undefined
  await realtime?.close()
  realtime = undefined
})

describe('Runtime process', () => {
  test('owns mock runtime sessions and exposes the RuntimePort command surface', async () => {
    realtime = await startRealtime()
    const persistence: RuntimePersistenceUpdate[] = []
    runtime = await createProcessRuntimePort({
      realtimeStreamEndpoint: realtime.runtimeStreamEndpoint,
      realtimeStreamToken: realtime.runtimeStreamToken,
      onPersistenceUpdate: async (update) => { persistence.push(update) },
      onDone: async () => undefined,
    })
    const state = snapshot('session-a')

    const acpSessionId = await runtime.ensureSession(state)
    expect(acpSessionId).toMatch(/^mock-session-/)
    await expect(runtime.getSessionCapabilities('agent-a', 'session-a')).resolves.toMatchObject({
      currentModelId: 'mock-fast',
      currentModeId: 'default',
    })
    await runtime.setModel('agent-a', 'session-a', 'mock-smart')
    await runtime.setMode('agent-a', 'session-a', 'plan')
    await runtime.setConfig('agent-a', 'session-a', 'effort', 'high')

    await runtime.prompt({ agentId: 'agent-a', sessionId: 'session-a', content: 'hello runtime' })
    expect(persistence.some((item) => item.update.kind === 'session-update')).toBe(true)
    await expect(runtime.resolvePermission('session-a', 'missing', 'allow_once')).resolves.toBe(false)
    await expect(runtime.resolveElicitation('session-a', 'missing', 'cancel')).resolves.toBe(false)

    const forked = await runtime.forkSession(snapshot('session-b'), acpSessionId)
    expect(forked).toMatch(/^mock-session-/)
    await runtime.closeSession('agent-a', 'session-a')
    await runtime.drain()
  }, 15_000)

  test('allows a prompt to outlive the timeout reserved for short control requests', async () => {
    realtime = await startRealtime()
    const doneEvents: string[] = []
    runtime = await createProcessRuntimePort({
      realtimeStreamEndpoint: realtime.runtimeStreamEndpoint,
      realtimeStreamToken: realtime.runtimeStreamToken,
      onPersistenceUpdate: async () => undefined,
      onDone: async (event) => { doneEvents.push(event.sessionId) },
      requestTimeoutMs: 250,
    })
    await runtime.ensureSession(snapshot('session-long-prompt'))

    await expect(runtime.prompt({
      agentId: 'agent-a',
      sessionId: 'session-long-prompt',
      content: 'x'.repeat(600),
    })).resolves.toBeUndefined()

    expect(doneEvents).toEqual(['session-long-prompt'])
  }, 15_000)
})

function startRealtime(): Promise<RealtimeProcessHandle> {
  return createRealtimeProcess({
    host: '127.0.0.1',
    port: 0,
    authenticate: async () => ({ authMode: 'owner' }),
    dispatchLegacyRpc: async ({ state }) => state.subscriptions,
  })
}

export function snapshot(sessionId: string): RuntimeStateSnapshot {
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
