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

  test('deduplicates concurrent recovery of one missing provisional Session', async () => {
    const harness = runtimeHarness({ resumeError: new Error('Resource not found: acp-stale') })
    const recovering = snapshot('session-a')
    recovering.session.acpSessionId = 'acp-stale'
    recovering.session.canRecreateMissingSession = true

    const [first, second] = await Promise.all([
      harness.host.ensureSession(recovering),
      harness.host.ensureSession(recovering),
    ])

    expect(first).toBe('acp-created')
    expect(second).toBe('acp-created')
    expect(harness.resumeSession).toHaveBeenCalledOnce()
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

  test('defers a changed Session context while its prompt is active', async () => {
    let finishPrompt: ((value: { stopReason: string }) => void) | undefined
    const promptResult = new Promise<{ stopReason: string }>((resolve) => { finishPrompt = resolve })
    const harness = runtimeHarness({ prompt: () => promptResult })
    const initial = snapshot('session-a')
    await harness.host.ensureSession(initial)
    const prompt = harness.host.prompt({
      agentId: 'agent-a',
      sessionId: 'session-a',
      content: 'hello',
      diagnostics: { messageId: 'message-a', turnId: 'turn-a' },
    })
    await harness.promptStarted

    const changed = {
      ...initial,
      session: { ...initial.session, cwd: `${initial.session.cwd}/other`, acpSessionId: 'acp-created' },
    }
    await expect(harness.host.ensureSession(changed)).resolves.toBe('acp-created')
    expect(harness.resumeSession).not.toHaveBeenCalled()

    finishPrompt?.({ stopReason: 'end_turn' })
    await prompt
    await harness.host.ensureSession(changed)

    expect(harness.resumeSession).toHaveBeenCalledOnce()
  })

  test('waits for active Agent turns before replacing a changed model connection', async () => {
    let finishPrompt: ((value: { stopReason: string }) => void) | undefined
    const promptResult = new Promise<{ stopReason: string }>((resolve) => { finishPrompt = resolve })
    const harness = runtimeHarness({ prompt: () => promptResult })
    const initial = snapshot('session-a')
    initial.runtime.gatewayAuth = gatewayAuth('fingerprint-a')
    await harness.host.ensureSession(initial)
    const prompt = harness.host.prompt({ agentId: 'agent-a', sessionId: 'session-a', content: 'hello' })
    await harness.promptStarted

    const changed = snapshot('session-b')
    changed.runtime.gatewayAuth = gatewayAuth('fingerprint-b')
    const ensureChanged = harness.host.ensureSession(changed)
    await Promise.resolve()

    expect(harness.processes).toHaveLength(1)
    expect(harness.processes[0].kill).not.toHaveBeenCalled()

    finishPrompt?.({ stopReason: 'end_turn' })
    await prompt
    await ensureChanged

    expect(harness.processes[0].kill).toHaveBeenCalledOnce()
    expect(harness.processes).toHaveLength(2)
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

  test('does not auto-approve from a desired mode that ACP did not confirm', async () => {
    const harness = runtimeHarness()
    const requested = snapshot('session-a')
    requested.runtimePreferences.modeId = 'bypassPermissions'
    await harness.host.ensureSession(requested)

    const permission = harness.routers[0].client.requestPermission(permissionRequest())

    expect(harness.routers[0].hasPendingInteractions('session-a')).toBe(true)
    harness.routers[0].cancelSession('session-a')
    await expect(permission).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
  })

  test('auto-approves after ACP successfully changes to a full-access mode', async () => {
    const harness = runtimeHarness()
    await harness.host.ensureSession(snapshot('session-a'))
    await harness.host.setMode('agent-a', 'session-a', 'bypassPermissions')

    const permission = harness.routers[0].client.requestPermission(permissionRequest())

    await expect(permission).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } })
    expect(harness.routers[0].hasPendingInteractions('session-a')).toBe(false)
  })

  test('uses the mode confirmed by ACP after changing a config option', async () => {
    const harness = runtimeHarness({
      setConfigResult: async () => ({
        configOptions: [{
          id: 'mode',
          name: 'Permission mode',
          category: 'mode',
          type: 'select' as const,
          currentValue: 'default',
          options: [
            { value: 'default', name: 'Default' },
            { value: 'bypassPermissions', name: 'Bypass permissions' },
          ],
        }],
      }),
    })
    await harness.host.ensureSession(snapshot('session-a'))

    await harness.host.setConfig('agent-a', 'session-a', 'mode', 'bypassPermissions')
    const permission = harness.routers[0].client.requestPermission(permissionRequest())

    expect(harness.host.getSessionCapabilities('agent-a', 'session-a')?.currentModeId).toBe('default')
    expect(harness.routers[0].hasPendingInteractions('session-a')).toBe(true)
    harness.routers[0].cancelSession('session-a')
    await expect(permission).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
  })

  test('publishes updated capabilities after changing a Session config option', async () => {
    const harness = runtimeHarness()
    const state = snapshot('session-a')
    await harness.host.ensureSession(state)
    harness.publishUpdate.mockClear()

    await harness.host.setConfig('agent-a', 'session-a', 'effort', 'high')

    expect(harness.publishCapabilities).toHaveBeenCalledWith(
      'session-a',
      expect.objectContaining({
        configOptions: [expect.objectContaining({ id: 'effort', currentValue: 'high' })],
      }),
    )
    expect(harness.publishUpdate).toHaveBeenCalledWith(
      'agent-a',
      expect.objectContaining({
        kind: 'session-update',
        sessionId: 'session-a',
        data: expect.objectContaining({
          configOptions: [expect.objectContaining({ id: 'effort', currentValue: 'high' })],
        }),
      }),
    )
    expect(state.runtimePreferences.config).toEqual({ effort: 'high' })
  })

  test('publishes the final config snapshot after restoring Session preferences', async () => {
    const harness = runtimeHarness({
      initialConfigOptions: [effortOption('default')],
      setConfigResult: async () => ({ configOptions: [effortOption('max')] }),
    })
    const state = snapshot('session-a')
    state.runtimePreferences.config = { effort: 'max' }

    await harness.host.ensureSession(state)

    const configUpdates = harness.publishUpdate.mock.calls
      .map(([, update]) => update)
      .filter((update) => update.kind === 'session-update' && update.data?.configOptions)
    expect(configUpdates.at(-1)).toMatchObject({
      sessionId: 'session-a',
      data: {
        configOptions: [expect.objectContaining({ id: 'effort', currentValue: 'max' })],
      },
    })
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
    forked.runtime.env.CLAUDE_CONFIG_DIR = 'C:\\custom-claude'

    await expect(harness.host.forkSession(forked, 'acp-created')).resolves.toBe('acp-forked')
    expect(harness.host.getSessionCapabilities('agent-a', 'session-b')).toMatchObject({
      currentModelId: 'model-a',
      supportsImages: true,
    })
    expect(harness.cloneClaudeSessionFiles).toHaveBeenCalledWith({
      sourceSessionId: 'acp-created',
      targetSessionId: 'acp-forked',
      sourceCwd: process.cwd(),
      targetCwd: process.cwd(),
      configDir: 'C:\\custom-claude',
    })
  })

  test('closes an in-memory Claude fork when file materialization fails', async () => {
    const harness = runtimeHarness({
      cloneClaudeSessionFiles: async () => { throw new Error('snapshot write failed') },
    })
    const forked = snapshot('session-b')
    forked.session.acpSessionId = 'acp-created'

    await expect(harness.host.forkSession(forked, 'acp-created')).rejects.toThrow('snapshot write failed')

    expect(harness.closeSession).toHaveBeenCalledWith({ sessionId: 'acp-forked' })
    expect(harness.host.hasSession('session-b')).toBe(false)
  })

  test('rejects a Claude fork before ACP when the source JSONL is missing', async () => {
    const harness = runtimeHarness({ hasClaudeSessionFiles: async () => false })
    const forked = snapshot('session-b')
    forked.session.acpSessionId = 'acp-created'

    await expect(harness.host.forkSession(forked, 'acp-created')).rejects.toThrow(
      'Claude Session snapshot is missing',
    )

    expect(harness.unstableForkSession).not.toHaveBeenCalled()
    expect(harness.cloneClaudeSessionFiles).not.toHaveBeenCalled()
  })
})

function runtimeHarness(overrides: {
  prompt?: () => Promise<{ stopReason: string }>
  cancel?: () => void | Promise<void>
  closeSession?: () => void | Promise<void>
  cancelGraceMs?: number
  closeGraceMs?: number
  restartGraceMs?: number
  setConfigResult?: () => Promise<{ configOptions: acp.SessionConfigOption[] }>
  initialConfigOptions?: acp.SessionConfigOption[]
  cloneClaudeSessionFiles?: () => Promise<unknown>
  hasClaudeSessionFiles?: () => Promise<boolean>
  resumeError?: Error
} = {}) {
  const processes: EventEmitter[] = []
  const routers: AcpRuntimeClientRouter[] = []
  const actors = new RuntimeSessionActorScheduler()
  let markPromptStarted: (() => void) | undefined
  const promptStarted = new Promise<void>((resolve) => { markPromptStarted = resolve })
  const newSession = vi.fn(async () => ({
    sessionId: 'acp-created',
    configOptions: overrides.initialConfigOptions,
  }))
  const resumeSession = vi.fn(async () => {
    if (overrides.resumeError) throw overrides.resumeError
    return {}
  })
  const publishUpdate = vi.fn()
  const publishCapabilities = vi.fn()
  const publishDone = vi.fn(async () => undefined)
  const closeSession = vi.fn(async () => { await overrides.closeSession?.() })
  const unstableForkSession = vi.fn(async () => ({
    sessionId: 'acp-forked',
    models: {
      currentModelId: 'model-a',
      availableModels: [{ modelId: 'model-a', name: 'Model A' }],
    },
  }))
  const cloneClaudeSessionFiles = vi.fn(overrides.cloneClaudeSessionFiles ?? (async () => ({
    jsonlPath: 'snapshot.jsonl',
    lineCount: 1,
    resourceFilesCopied: 0,
  })))
  const host = new SdkRuntimeHost(actors, {
    publishUpdate,
    publishDone,
    publishCapabilities,
  }, {
    cancelGraceMs: overrides.cancelGraceMs,
    closeGraceMs: overrides.closeGraceMs,
    restartGraceMs: overrides.restartGraceMs,
    cloneClaudeSessionFiles,
    hasClaudeSessionFiles: overrides.hasClaudeSessionFiles ?? (async () => true),
    startAgent: async ({ router }) => {
      const process = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) })
      const connection = {
        newSession,
        resumeSession,
        loadSession: vi.fn(async () => ({})),
        unstable_forkSession: unstableForkSession,
        unstable_setSessionModel: vi.fn(async () => undefined),
        setSessionMode: vi.fn(async () => undefined),
        prompt: vi.fn(() => {
          markPromptStarted?.()
          return overrides.prompt?.() ?? Promise.resolve({ stopReason: 'end_turn' })
        }),
        setSessionConfigOption: vi.fn(async () => overrides.setConfigResult?.() ?? ({
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
    publishUpdate,
    publishCapabilities,
    publishDone,
    closeSession,
    cloneClaudeSessionFiles,
    unstableForkSession,
  }
}

function effortOption(currentValue: string): acp.SessionConfigOption {
  return {
    id: 'effort',
    name: 'Reasoning effort',
    category: 'thought_level',
    type: 'select',
    currentValue,
    options: [
      { value: 'default', name: 'Default' },
      { value: 'max', name: 'Max' },
    ],
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

function gatewayAuth(fingerprint: string): NonNullable<RuntimeStateSnapshot['runtime']['gatewayAuth']> {
  return {
    methodId: 'gateway',
    baseUrl: 'https://gateway.example.com/v1',
    providerName: 'Gateway',
    headers: { Authorization: 'Bearer secret' },
    fingerprint,
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
