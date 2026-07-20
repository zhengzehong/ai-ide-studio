import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import type * as acp from '@agentclientprotocol/sdk'
import { describe, expect, test, vi } from 'vitest'
import type { RuntimeStateSnapshot } from '../../src/ports/runtime-port.js'
import { RuntimeSessionActorScheduler } from '../../src/runtime/actors/session-actor.js'
import type { AcpRuntimeClientRouter } from '../../src/runtime/service/acp-runtime-client.js'
import { SdkRuntimeHost } from '../../src/runtime/service/sdk-runtime-host.js'

describe('SDK Runtime child lifecycle', () => {
  test('cancel and close resolve pending Session interactions', async () => {
    const harness = runtimeHarness()
    const host = harness.host
    await host.ensureSession(snapshot('session-a'))
    const router = harness.routers[0]
    const permission = router.client.requestPermission(permissionRequest())

    await host.cancelPrompt('agent-a', 'session-a')
    await expect(permission).resolves.toEqual({ outcome: { outcome: 'cancelled' } })

    const elicitation = router.client.unstable_createElicitation(elicitationRequest())
    await host.closeSession('agent-a', 'session-a')
    await expect(elicitation).resolves.toEqual({ action: 'cancel' })
    await expect(host.closeSession('agent-a', 'session-a')).resolves.toBeUndefined()
  })

  test('child exit rejects the active turn, clears Sessions, and permits a fresh resume', async () => {
    const harness = runtimeHarness({ prompt: () => new Promise(() => undefined) })
    const host = harness.host
    await host.ensureSession(snapshot('session-a'))
    const permission = harness.routers[0].client.requestPermission(permissionRequest())
    const prompt = host.prompt({ agentId: 'agent-a', sessionId: 'session-a', content: 'hello' })
    await harness.promptStarted

    harness.processes[0].emit('exit', 1, null)

    await expect(prompt).rejects.toThrow('Agent runtime exited')
    await expect(permission).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
    expect(host.hasSession('session-a')).toBe(false)

    const resumed = await host.ensureSession({
      ...snapshot('session-a'),
      session: { ...snapshot('session-a').session, acpSessionId: 'acp-persisted' },
    })
    expect(resumed).toBe('acp-persisted')
    expect(harness.processes).toHaveLength(2)
  })

  test('deduplicates concurrent ensure calls for one Session', async () => {
    const harness = runtimeHarness()

    const [first, second] = await Promise.all([
      harness.host.ensureSession(snapshot('session-a')),
      harness.host.ensureSession(snapshot('session-a')),
    ])

    expect(first).toBe('acp-created')
    expect(second).toBe('acp-created')
    expect(harness.processes).toHaveLength(1)
    expect(harness.newSession).toHaveBeenCalledOnce()
  })

  test('reuses an unchanged Session context and reconnects when the context changes', async () => {
    const harness = runtimeHarness()
    const initial = snapshot('session-a')
    await harness.host.ensureSession(initial)

    await harness.host.ensureSession({ ...initial, session: { ...initial.session } })
    await harness.host.ensureSession({
      ...initial,
      session: { ...initial.session, cwd: `${initial.session.cwd}/other`, acpSessionId: 'acp-created' },
    })

    expect(harness.newSession).toHaveBeenCalledOnce()
    expect(harness.resumeSession).toHaveBeenCalledOnce()
  })
})

function runtimeHarness(overrides: { prompt?: () => Promise<never> } = {}) {
  const processes: EventEmitter[] = []
  const routers: AcpRuntimeClientRouter[] = []
  const actors = new RuntimeSessionActorScheduler()
  let markPromptStarted: (() => void) | undefined
  const promptStarted = new Promise<void>((resolve) => { markPromptStarted = resolve })
  const newSession = vi.fn(async () => ({ sessionId: 'acp-created' }))
  const resumeSession = vi.fn(async () => ({}))
  const host = new SdkRuntimeHost(actors, {
    publishUpdate: () => undefined,
    publishDone: async () => undefined,
  }, {
    startAgent: async ({ router }) => {
      const process = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) })
      const connection = {
        newSession,
        resumeSession,
        loadSession: vi.fn(async () => ({})),
        prompt: vi.fn(() => {
          markPromptStarted?.()
          return overrides.prompt?.() ?? Promise.resolve({ stopReason: 'end_turn' })
        }),
        cancel: vi.fn(async () => undefined),
        closeSession: vi.fn(async () => undefined),
      } as unknown as acp.ClientSideConnection
      processes.push(process)
      routers.push(router)
      return {
        process: process as unknown as ChildProcess,
        connection,
        agentCapabilities: { sessionCapabilities: { resume: true } } as acp.AgentCapabilities,
      }
    },
  })
  return { host, processes, routers, promptStarted, newSession, resumeSession }
}

function snapshot(sessionId: string): RuntimeStateSnapshot {
  return {
    agent: { id: 'agent-a', name: 'Agent', type: 'dev', runtime: 'claude', permissionLevel: 3, config: {}, systemPrompt: '', projectId: 'project-a' },
    session: { id: sessionId, agentId: 'agent-a', taskId: null, projectId: 'project-a', cwd: process.cwd(), title: null, acpSessionId: null, isPrimary: false },
    runtime: { env: {}, command: { cmd: 'unused', args: [] } },
    runtimePreferences: {},
    mcpServers: [],
    autoApprovedToolNames: [],
  }
}

function permissionRequest(): never {
  return {
    sessionId: 'acp-created',
    toolCall: { toolCallId: 'tool-a', title: 'Terminal' },
    options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
  } as never
}

function elicitationRequest(): never {
  return {
    sessionId: 'acp-created',
    mode: 'form',
    message: 'Choose',
    requestedSchema: { type: 'object', properties: {} },
  } as never
}
