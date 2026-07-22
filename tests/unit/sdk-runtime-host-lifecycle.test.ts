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

  test('reports missing and idle Sessions without silently claiming cancellation', async () => {
    const harness = runtimeHarness()

    await expect(harness.host.cancelPrompt('agent-a', 'missing')).resolves.toEqual({ status: 'not-found' })
    await harness.host.ensureSession(snapshot('session-a'))
    await expect(harness.host.cancelPrompt('agent-a', 'session-a')).resolves.toEqual({ status: 'not-active' })
  })

  test('waits for soft ACP cancellation and publishes one cancelled terminal for the original turn', async () => {
    let finishPrompt: ((value: { stopReason: string }) => void) | undefined
    const promptResult = new Promise<{ stopReason: string }>((resolve) => { finishPrompt = resolve })
    const harness = runtimeHarness({
      prompt: () => promptResult,
      cancel: () => { finishPrompt?.({ stopReason: 'cancelled' }) },
    })
    await harness.host.ensureSession(snapshot('session-a'))
    const prompt = harness.host.prompt({
      agentId: 'agent-a',
      sessionId: 'session-a',
      content: 'hello',
      diagnostics: { turnId: 'turn-a', messageId: 'message-a' },
    })
    await harness.promptStarted

    await expect(harness.host.cancelPrompt('agent-a', 'session-a')).resolves.toEqual({
      status: 'requested',
      escalation: 'cancel',
      turnId: 'turn-a',
      messageId: 'message-a',
    })
    await expect(prompt).resolves.toBeUndefined()
    expect(harness.publishDone).toHaveBeenCalledTimes(1)
    expect(harness.publishDone).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-a',
      messageId: 'message-a',
      turnId: 'turn-a',
      stopReason: 'cancelled',
    }))
  })

  test('escalates a stuck ACP cancellation to closing only the target Session', async () => {
    let finishPrompt: ((value: { stopReason: string }) => void) | undefined
    const promptResult = new Promise<{ stopReason: string }>((resolve) => { finishPrompt = resolve })
    const harness = runtimeHarness({
      prompt: () => promptResult,
      closeSession: () => { finishPrompt?.({ stopReason: 'cancelled' }) },
      cancelGraceMs: 1,
      closeGraceMs: 50,
    })
    await harness.host.ensureSession(snapshot('session-a'))
    const prompt = harness.host.prompt({ agentId: 'agent-a', sessionId: 'session-a', content: 'hello' })
    await harness.promptStarted

    await expect(harness.host.cancelPrompt('agent-a', 'session-a')).resolves.toMatchObject({
      status: 'requested',
      escalation: 'session-close',
    })
    await expect(prompt).resolves.toBeUndefined()
    expect(harness.closeSession).toHaveBeenCalledOnce()
    expect(harness.processes[0].kill).not.toHaveBeenCalled()
    expect(harness.publishDone).toHaveBeenCalledTimes(1)
    expect(harness.host.hasSession('session-a')).toBe(false)
  })

  test('restarts the owning Agent when cancel and close cannot terminate the turn', async () => {
    const harness = runtimeHarness({
      prompt: () => new Promise(() => undefined),
      cancelGraceMs: 1,
      closeGraceMs: 1,
      restartGraceMs: 50,
    })
    await harness.host.ensureSession(snapshot('session-a'))
    const prompt = harness.host.prompt({
      agentId: 'agent-a',
      sessionId: 'session-a',
      content: 'hello',
      diagnostics: { turnId: 'turn-hard', messageId: 'message-hard' },
    })
    await harness.promptStarted

    await expect(harness.host.cancelPrompt('agent-a', 'session-a')).resolves.toMatchObject({
      status: 'requested',
      escalation: 'agent-restart',
    })
    await expect(prompt).resolves.toBeUndefined()
    expect(harness.processes[0].kill).toHaveBeenCalledOnce()
    expect(harness.host.hasSession('session-a')).toBe(false)
    expect(harness.publishDone).toHaveBeenCalledTimes(1)
    expect(harness.publishDone).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'message-hard',
      turnId: 'turn-hard',
      stopReason: 'cancelled',
    }))
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

  test('publishes updated capabilities after changing the Session model', async () => {
    const harness = runtimeHarness()
    await harness.host.ensureSession(snapshot('session-a'))

    await harness.host.setModel('agent-a', 'session-a', 'model-b')

    expect(harness.publishCapabilities).toHaveBeenCalledWith(
      'session-a',
      expect.objectContaining({ currentModelId: 'model-b' }),
    )
  })

  test('publishes updated capabilities after changing the Session mode', async () => {
    const harness = runtimeHarness()
    await harness.host.ensureSession(snapshot('session-a'))

    await harness.host.setMode('agent-a', 'session-a', 'plan')

    expect(harness.publishCapabilities).toHaveBeenCalledWith(
      'session-a',
      expect.objectContaining({ currentModeId: 'plan' }),
    )
  })

  test('publishes updated capabilities after changing a Session config option', async () => {
    const harness = runtimeHarness()
    await harness.host.ensureSession(snapshot('session-a'))

    await harness.host.setConfig('agent-a', 'session-a', 'effort', 'high')

    expect(harness.publishCapabilities).toHaveBeenCalledWith(
      'session-a',
      expect.objectContaining({
        configOptions: [expect.objectContaining({ id: 'effort', currentValue: 'high' })],
      }),
    )
  })

  test('keeps an idle Session while an interaction is pending', async () => {
    const harness = runtimeHarness()
    const host = harness.host
    await host.ensureSession(snapshot('session-a'))
    const permission = harness.routers[0].client.requestPermission(permissionRequest())

    await host.sweepIdle(Date.now() + 60_000, { sessionIdleMs: 1, agentIdleMs: 1 })

    expect(host.hasSession('session-a')).toBe(true)
    await host.cancelPrompt('agent-a', 'session-a')
    await expect(permission).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
  })

  test('maps forked Session capabilities through the shared SDK mapper', async () => {
    const harness = runtimeHarness()
    const forked = snapshot('session-b')
    forked.session.acpSessionId = 'acp-created'

    await expect(harness.host.forkSession(forked, 'acp-created')).resolves.toBe('acp-forked')
    expect(harness.host.getSessionCapabilities('agent-a', 'session-b')).toMatchObject({
      currentModelId: 'model-a',
      supportsImages: true,
    })
  })
})

function runtimeHarness(overrides: {
  prompt?: () => Promise<{ stopReason: string }>
  cancel?: () => void | Promise<void>
  closeSession?: () => void | Promise<void>
  cancelGraceMs?: number
  closeGraceMs?: number
  restartGraceMs?: number
} = {}) {
  const processes: EventEmitter[] = []
  const routers: AcpRuntimeClientRouter[] = []
  const actors = new RuntimeSessionActorScheduler()
  let markPromptStarted: (() => void) | undefined
  const promptStarted = new Promise<void>((resolve) => { markPromptStarted = resolve })
  const newSession = vi.fn(async () => ({ sessionId: 'acp-created' }))
  const resumeSession = vi.fn(async () => ({}))
  const publishCapabilities = vi.fn()
  const publishDone = vi.fn(async () => undefined)
  const closeSession = vi.fn(async () => { await overrides.closeSession?.() })
  const host = new SdkRuntimeHost(actors, {
    publishUpdate: () => undefined,
    publishDone,
    publishCapabilities,
  }, {
    cancelGraceMs: overrides.cancelGraceMs,
    closeGraceMs: overrides.closeGraceMs,
    restartGraceMs: overrides.restartGraceMs,
    startAgent: async ({ router }) => {
      const process = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) })
      const connection = {
        newSession,
        resumeSession,
        loadSession: vi.fn(async () => ({})),
        unstable_forkSession: vi.fn(async () => ({
          sessionId: 'acp-forked',
          models: {
            currentModelId: 'model-a',
            availableModels: [{ modelId: 'model-a', name: 'Model A' }],
          },
        })),
        unstable_setSessionModel: vi.fn(async () => undefined),
        setSessionMode: vi.fn(async () => undefined),
        prompt: vi.fn(() => {
          markPromptStarted?.()
          return overrides.prompt?.() ?? Promise.resolve({ stopReason: 'end_turn' })
        }),
        setSessionConfigOption: vi.fn(async () => ({
          configOptions: [{
            id: 'effort',
            name: 'Reasoning effort',
            category: 'thought_level',
            type: 'select' as const,
            currentValue: 'high',
            options: [{ value: 'high', name: 'High' }],
          }],
        })),
        cancel: vi.fn(async () => { await overrides.cancel?.() }),
        closeSession,
      } as unknown as acp.ClientSideConnection
      processes.push(process)
      routers.push(router)
      return {
        process: process as unknown as ChildProcess,
        connection,
        agentCapabilities: {
          sessionCapabilities: { resume: true, fork: true },
          promptCapabilities: { image: true },
        } as acp.AgentCapabilities,
      }
    },
  })
  return {
    host,
    processes,
    routers,
    promptStarted,
    newSession,
    resumeSession,
    publishCapabilities,
    publishDone,
    closeSession,
  }
}

function snapshot(sessionId: string): RuntimeStateSnapshot {
  return {
    agent: { id: 'agent-a', name: 'Agent', type: 'dev', runtime: 'claude', permissionLevel: 3, config: {}, systemPrompt: '', projectId: 'project-a' },
    session: { id: sessionId, agentId: 'agent-a', taskId: null, projectId: 'project-a', cwd: process.cwd(), title: null, acpSessionId: null, isPrimary: false },
    runtime: { env: {}, command: { cmd: 'unused', args: [] } },
    runtimePreferences: { modeId: 'default' },
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
