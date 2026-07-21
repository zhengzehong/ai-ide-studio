import { afterEach, describe, expect, test, vi } from 'vitest'
import type { RuntimeStateSnapshot } from '../../src/ports/runtime-port.js'
import { RuntimeIdleSweep } from '../../src/runtime/service/runtime-idle-sweep.js'
import { AcpRuntimeHost } from '../../src/runtime/service/acp-runtime-host.js'

const hosts: AcpRuntimeHost[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(hosts.splice(0).map((host) => host.close()))
})

describe('Runtime idle sweep', () => {
  test('disconnects idle Sessions before stopping their idle Agent', async () => {
    const updates: Array<Record<string, unknown>> = []
    const statuses: string[] = []
    const host = createHost(updates, statuses)
    await host.ensureSession(snapshot('session-a'))
    const now = Date.now()

    await host.sweepIdle(now + 200, { sessionIdleMs: 100, agentIdleMs: 1_000 })

    expect(host.sessionCount).toBe(0)
    expect(host.agentCount).toBe(1)
    expect(updates.some((update) => update.eventType === 'lifecycle.session_disconnected')).toBe(true)

    await host.sweepIdle(now + 2_000, { sessionIdleMs: 100, agentIdleMs: 1_000 })

    expect(host.agentCount).toBe(0)
    expect(statuses).toEqual(['agent-a:running', 'agent-a:standby'])
  })

  test('does not disconnect a Session while its Prompt is active', async () => {
    const host = createHost([], [])
    await host.ensureSession(snapshot('session-a'))
    const prompt = host.prompt({ agentId: 'agent-a', sessionId: 'session-a', content: 'x'.repeat(500) })
    await vi.waitFor(() => expect(host.pendingCommandCount).toBeGreaterThan(0))

    await host.sweepIdle(Date.now() + 60_000, { sessionIdleMs: 1, agentIdleMs: 1 })

    expect(host.sessionCount).toBe(1)
    await host.cancelPrompt('agent-a', 'session-a')
    await prompt
  })

  test('starts once and stops the process sweep timer cleanly', async () => {
    vi.useFakeTimers()
    const sweep = vi.fn(async () => undefined)
    const loop = new RuntimeIdleSweep({ intervalMs: 50, sweep })

    loop.start()
    loop.start()
    await vi.advanceTimersByTimeAsync(150)
    expect(sweep).toHaveBeenCalledTimes(3)

    await loop.stop()
    await vi.advanceTimersByTimeAsync(150)
    expect(sweep).toHaveBeenCalledTimes(3)
  })

  test('waits for an in-flight sweep before stopping', async () => {
    vi.useFakeTimers()
    const gate = deferred<void>()
    const loop = new RuntimeIdleSweep({ intervalMs: 50, sweep: async () => gate.promise })
    loop.start()
    await vi.advanceTimersByTimeAsync(50)

    let stopped = false
    const stopping = loop.stop().then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)

    gate.resolve()
    await stopping
    expect(stopped).toBe(true)
  })
})

function createHost(updates: Array<Record<string, unknown>>, statuses: string[]): AcpRuntimeHost {
  const host = new AcpRuntimeHost({
    publishUpdate: (_agentId, update) => {
      if (update.kind === 'session-update' && update.data) updates.push(update.data as Record<string, unknown>)
    },
    publishDone: async () => undefined,
    publishAgentStatus: (event) => statuses.push(`${event.agentId}:${event.status}`),
  })
  hosts.push(host)
  return host
}

function snapshot(sessionId: string): RuntimeStateSnapshot {
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve })
  return { promise, resolve: resolvePromise }
}
