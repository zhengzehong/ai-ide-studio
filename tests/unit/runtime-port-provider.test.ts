import { describe, expect, test, vi } from 'vitest'
import type { RuntimePort, RuntimeStateSnapshot } from '../../src/ports/runtime-port.js'
import { EmbeddedRuntimePort, type EmbeddedRuntimeHost } from '../../src/runtime/api/embedded-runtime-port.js'
import {
  getRuntimePort,
  resetRuntimePort,
  setRuntimePort,
} from '../../src/runtime/runtime-port-provider.js'

function snapshot(): RuntimeStateSnapshot {
  return {
    agent: {
      id: 'agent-1',
      name: 'Agent 1',
      type: 'developer',
      runtime: 'mock',
      permissionLevel: 3,
      config: {},
      systemPrompt: '',
      projectId: 'project-1',
    },
    session: {
      id: 'session-1',
      agentId: 'agent-1',
      projectId: 'project-1',
      cwd: 'C:/workspace',
      title: null,
      taskId: null,
      acpSessionId: 'acp-1',
      isPrimary: false,
    },
    runtime: { env: {}, sessionMeta: undefined, command: undefined },
    runtimePreferences: {},
    mcpServers: [],
    autoApprovedToolNames: [],
  }
}

function runtimePort(): RuntimePort {
  return {
    ensureSession: vi.fn(async () => 'acp-1'),
    prompt: vi.fn(async () => undefined),
    cancelPrompt: vi.fn(async () => undefined),
    closeSession: vi.fn(async () => undefined),
    forkSession: vi.fn(async () => 'acp-fork'),
    setModel: vi.fn(async () => undefined),
    setMode: vi.fn(async () => undefined),
    setConfig: vi.fn(async () => undefined),
    getSessionCapabilities: vi.fn(async () => undefined),
    resolvePermission: vi.fn(async () => false),
    resolveElicitation: vi.fn(async () => false),
    drain: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }
}

describe('runtime port provider', () => {
  test('installs and resets one explicit runtime adapter', () => {
    const port = runtimePort()
    setRuntimePort(port)
    expect(getRuntimePort()).toBe(port)

    resetRuntimePort()
    expect(() => getRuntimePort()).toThrow('Runtime port is not initialized')
  })
})

describe('embedded runtime port', () => {
  test('delegates the closed runtime contract without exposing host internals', async () => {
    const host: EmbeddedRuntimeHost = {
      ensureSession: vi.fn(async () => 'acp-1'),
      prompt: vi.fn(async () => undefined),
      cancelPrompt: vi.fn(async () => undefined),
      closeSession: vi.fn(async () => undefined),
      forkSessionFromAcpSessionId: vi.fn(async () => 'acp-fork'),
      setModel: vi.fn(async () => undefined),
      setMode: vi.fn(async () => undefined),
      setConfig: vi.fn(async () => undefined),
      getSessionCapabilities: vi.fn(() => ({ currentModelId: 'mock-fast' })),
      resolvePermission: vi.fn(() => true),
      resolveElicitation: vi.fn(() => true),
      listRunning: vi.fn(() => ['agent-1']),
      stopAgent: vi.fn(async () => undefined),
    }
    const port = new EmbeddedRuntimePort(host)
    const state = snapshot()

    await expect(port.ensureSession(state, { emitLifecycle: false })).resolves.toBe('acp-1')
    await port.prompt({
      agentId: 'agent-1',
      sessionId: 'session-1',
      content: 'hello',
      diagnostics: { turnId: 'turn-1', messageId: 'message-1' },
    })
    await expect(port.forkSession(state, 'acp-source')).resolves.toBe('acp-fork')
    await port.cancelPrompt('agent-1', 'session-1')
    await port.setModel('agent-1', 'session-1', 'mock-smart')
    await port.setMode('agent-1', 'session-1', 'plan')
    await port.setConfig('agent-1', 'session-1', 'effort', 'high')
    await expect(port.getSessionCapabilities('agent-1', 'session-1')).resolves.toEqual({ currentModelId: 'mock-fast' })
    await expect(port.resolvePermission('session-1', 'request-1', 'allow_once')).resolves.toBe(true)
    await expect(port.resolveElicitation('session-1', 'request-2', 'accept', { answer: 'yes' })).resolves.toBe(true)
    await port.closeSession('agent-1', 'session-1')
    await port.drain()
    await port.close()

    expect(host.ensureSession).toHaveBeenCalledWith('agent-1', 'session-1', 'acp-1', {
      projectId: 'project-1',
      cwd: 'C:/workspace',
      emitLifecycle: false,
    })
    expect(host.prompt).toHaveBeenCalledWith('agent-1', 'session-1', 'hello', undefined, {
      turnId: 'turn-1',
      messageId: 'message-1',
    })
    expect(host.forkSessionFromAcpSessionId).toHaveBeenCalledWith(
      'agent-1',
      'acp-source',
      'session-1',
      { projectId: 'project-1', cwd: 'C:/workspace' },
    )
    expect(host.stopAgent).toHaveBeenCalledWith('agent-1')
    expect('agents' in port).toBe(false)
  })
})
