import type * as acp from '@agentclientprotocol/sdk'
import { describe, expect, test, vi } from 'vitest'
import type { RuntimeStateSnapshot } from '../../src/ports/runtime-port.js'
import { openSdkSession } from '../../src/runtime/service/sdk-session-runtime.js'

describe('SDK Session recovery', () => {
  test.each([
    ['claude', 'Resource not found: native-stale'],
    ['claude', 'No conversation found with session ID: native-stale'],
    ['codex', 'Request failed: thread not found: native-stale (-32600)'],
  ])('recreates one missing empty %s Session before the prompt starts', async (runtime, message) => {
    const connection = connectionHarness({ resumeError: new Error(message) })

    const opened = await openSdkSession({
      connection: connection.value,
      snapshot: snapshot(runtime, true),
      agentCapabilities: resumeCapabilities(),
      acpSessionIdToResume: 'native-stale',
    })

    expect(opened.acpSessionId).toBe('native-new')
    expect(connection.resumeSession).toHaveBeenCalledOnce()
    expect(connection.newSession).toHaveBeenCalledOnce()
  })

  test('does not silently recreate a missing Session with durable history', async () => {
    const connection = connectionHarness({ resumeError: new Error('Resource not found: native-stale') })

    await expect(openSdkSession({
      connection: connection.value,
      snapshot: snapshot('claude', false),
      agentCapabilities: resumeCapabilities(),
      acpSessionIdToResume: 'native-stale',
    })).rejects.toThrow('底层 Agent 会话历史已丢失')

    expect(connection.newSession).not.toHaveBeenCalled()
  })

  test('recreates a missing load-only Session', async () => {
    const connection = connectionHarness({ loadError: new Error('Resource not found: native-stale') })

    const opened = await openSdkSession({
      connection: connection.value,
      snapshot: snapshot('claude', true),
      agentCapabilities: { loadSession: true } as acp.AgentCapabilities,
      acpSessionIdToResume: 'native-stale',
    })

    expect(opened.acpSessionId).toBe('native-new')
    expect(connection.loadSession).toHaveBeenCalledOnce()
    expect(connection.newSession).toHaveBeenCalledOnce()
  })

  test('does not recreate for unrelated resume errors', async () => {
    const connection = connectionHarness({ resumeError: new Error('authentication failed') })

    await expect(openSdkSession({
      connection: connection.value,
      snapshot: snapshot('claude', true),
      agentCapabilities: resumeCapabilities(),
      acpSessionIdToResume: 'native-stale',
    })).rejects.toThrow('authentication failed')

    expect(connection.newSession).not.toHaveBeenCalled()
  })

  test('requires the exact stale Session ID before recreating', async () => {
    const connection = connectionHarness({ resumeError: new Error('Resource not found: native-stale-other') })

    await expect(openSdkSession({
      connection: connection.value,
      snapshot: snapshot('claude', true),
      agentCapabilities: resumeCapabilities(),
      acpSessionIdToResume: 'native-stale',
    })).rejects.toThrow('Resource not found: native-stale-other')

    expect(connection.newSession).not.toHaveBeenCalled()
  })

  test('attempts a missing Session replacement only once', async () => {
    const connection = connectionHarness({
      resumeError: new Error('Request failed: thread not found: native-stale (-32600)'),
      newError: new Error('new Session failed'),
    })

    await expect(openSdkSession({
      connection: connection.value,
      snapshot: snapshot('codex', true),
      agentCapabilities: resumeCapabilities(),
      acpSessionIdToResume: 'native-stale',
    })).rejects.toThrow('new Session failed')

    expect(connection.resumeSession).toHaveBeenCalledOnce()
    expect(connection.newSession).toHaveBeenCalledOnce()
  })
})

function connectionHarness(options: { resumeError?: Error; loadError?: Error; newError?: Error }): {
  value: acp.ClientSideConnection
  resumeSession: ReturnType<typeof vi.fn>
  loadSession: ReturnType<typeof vi.fn>
  newSession: ReturnType<typeof vi.fn>
} {
  const resumeSession = vi.fn(async () => {
    if (options.resumeError) throw options.resumeError
    return {}
  })
  const newSession = vi.fn(async () => {
    if (options.newError) throw options.newError
    return { sessionId: 'native-new' }
  })
  const loadSession = vi.fn(async () => {
    if (options.loadError) throw options.loadError
    return {}
  })
  return {
    value: { resumeSession, loadSession, newSession } as unknown as acp.ClientSideConnection,
    resumeSession,
    loadSession,
    newSession,
  }
}

function resumeCapabilities(): acp.AgentCapabilities {
  return { sessionCapabilities: { resume: true } } as acp.AgentCapabilities
}

function snapshot(runtime: string, canRecreateMissingSession: boolean): RuntimeStateSnapshot {
  return {
    agent: {
      id: 'agent-a',
      name: 'Agent',
      type: 'developer',
      runtime,
      permissionLevel: 3,
      config: {},
      systemPrompt: '',
      projectId: 'project-a',
    },
    session: {
      id: 'session-a',
      agentId: 'agent-a',
      taskId: null,
      projectId: 'project-a',
      cwd: process.cwd(),
      title: null,
      acpSessionId: 'native-stale',
      canRecreateMissingSession,
      isPrimary: false,
      purpose: 'conversation',
    },
    runtime: { env: {} },
    runtimePreferences: {},
    mcpServers: [],
    autoApprovedToolNames: [],
  }
}
