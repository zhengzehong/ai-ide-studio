import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeSessionCommand } from '../../src/commands/session-command-service.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { eventStore, sessionStore } from '../../src/store/sessions.js'
import { agentStore } from '../../src/store/agents.js'
import type { RuntimePort } from '../../src/ports/runtime-port.js'
import { setRuntimePort } from '../../src/runtime/runtime-port-provider.js'

let tmp: string
let resetRuntimePort: (() => void) | undefined
let runtime: RuntimePort

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-command-service-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
  runtime = fakeRuntimePort()
  resetRuntimePort = setRuntimePort(runtime)
})

afterEach(() => {
  resetRuntimePort?.()
  resetRuntimePort = undefined
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('Session command service', () => {
  it('marks a Session read and emits the existing changed payload', async () => {
    const session = sessionStore.create({ agentId: 'agent-1' })
    const changed: Array<{ sessionId: string; data: unknown }> = []
    const { events } = await import('../../src/core/events.js')
    events.on('session:changed', (event) => changed.push(event as { sessionId: string; data: unknown }))

    await executeSessionCommand({
      commandId: 'command-read',
      type: 'sessions.markRead',
      sessionId: session.id,
    })

    expect(sessionStore.get(session.id)?.last_read_at).toBeTruthy()
    expect(changed.at(-1)).toMatchObject({
      sessionId: session.id,
      data: { lastReadAt: expect.any(String) },
    })
  })

  it('preserves permission and elicitation runtime resolution plus persisted events', async () => {
    const session = sessionStore.create({ agentId: 'agent-1' })

    await executeSessionCommand({
      commandId: 'command-permission',
      type: 'permission.respond',
      sessionId: session.id,
      permissionRequestId: 'permission-1',
      optionId: 'allow_once',
    })
    await executeSessionCommand({
      commandId: 'command-elicitation',
      type: 'elicitation.respond',
      sessionId: session.id,
      elicitationRequestId: 'elicitation-1',
      action: 'accept',
      content: { answer: 'yes' },
    })

    expect(runtime.resolvePermission).toHaveBeenCalledWith(
      session.id,
      'permission-1',
      'allow_once',
      undefined,
    )
    expect(runtime.resolveElicitation).toHaveBeenCalledWith(
      session.id,
      'elicitation-1',
      'accept',
      { answer: 'yes' },
    )
    expect(eventStore.list(session.id).map((event) => event.type)).toEqual([
      'permission.result',
      'elicitation.result',
    ])
  })

  it('uses the existing Runtime cancel path and rejects missing Sessions', async () => {
    const session = sessionStore.create({ agentId: 'agent-1' })

    await executeSessionCommand({
      commandId: 'command-cancel',
      type: 'session.cancel',
      sessionId: session.id,
    })

    expect(runtime.cancelPrompt).toHaveBeenCalledWith('agent-1', session.id)
    await expect(executeSessionCommand({
      commandId: 'command-missing',
      type: 'session.cancel',
      sessionId: 'missing',
    })).rejects.toThrow('会话不存在')
  })
  it('surfaces a Runtime ownership mismatch instead of reporting cancel success', async () => {
    const session = sessionStore.create({ agentId: 'agent-1' })
    vi.mocked(runtime.cancelPrompt).mockResolvedValueOnce({ status: 'not-found' })

    await expect(executeSessionCommand({
      commandId: 'command-owner-mismatch',
      type: 'session.cancel',
      sessionId: session.id,
    })).rejects.toThrow('Runtime does not own Session')
  })

  it('waits for Runtime terminal cancellation without fabricating a timeout done event', async () => {
    vi.useFakeTimers()
    const agent = agentStore.create({ id: 'agent-terminal-cancel', name: 'Cancel Agent', type: 'developer', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    let finishPrompt: (() => void) | undefined
    runtime.prompt = vi.fn(() => new Promise<void>((resolve) => { finishPrompt = resolve }))
    runtime.cancelPrompt = vi.fn(() => new Promise((resolve) => {
      setTimeout(() => resolve({
        status: 'requested',
        escalation: 'cancel',
        messageId: 'message-original',
        turnId: 'turn-original',
      }), 11_000)
    }))
    const { events } = await import('../../src/core/events.js')
    const doneEvents: Array<{ messageId: string }> = []
    const onDone = (event: { messageId: string }): void => { doneEvents.push(event) }
    events.on('session:done', onDone)

    const prompt = executeSessionCommand({
      commandId: 'command-prompt-active',
      type: 'prompt',
      sessionId: session.id,
      content: 'keep running',
      clientMessageId: 'message-human',
    })
    for (let attempt = 0; attempt < 20 && !vi.mocked(runtime.prompt).mock.calls.length; attempt += 1) {
      await Promise.resolve()
    }
    expect(runtime.prompt).toHaveBeenCalledOnce()

    const cancel = executeSessionCommand({
      commandId: 'command-cancel-terminal',
      type: 'session.cancel',
      sessionId: session.id,
    })
    await vi.advanceTimersByTimeAsync(11_000)
    await expect(cancel).resolves.toEqual({ ok: true })
    expect(doneEvents).toEqual([])

    finishPrompt?.()
    await prompt
    events.off('session:done', onDone)
    vi.useRealTimers()
  })
})

function fakeRuntimePort(): RuntimePort {
  return {
    ensureSession: vi.fn(async () => 'acp-1'),
    prompt: vi.fn(async () => undefined),
    cancelPrompt: vi.fn(async () => ({ status: 'not-active' as const })),
    closeSession: vi.fn(async () => undefined),
    forkSession: vi.fn(async () => 'acp-fork'),
    setModel: vi.fn(async () => undefined),
    setMode: vi.fn(async () => undefined),
    setConfig: vi.fn(async () => undefined),
    getSessionCapabilities: vi.fn(async () => undefined),
    resolvePermission: vi.fn(async () => true),
    resolveElicitation: vi.fn(async () => true),
    drain: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }
}
