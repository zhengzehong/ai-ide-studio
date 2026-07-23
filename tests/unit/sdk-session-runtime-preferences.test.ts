import { describe, expect, test, vi } from 'vitest'
import type { RuntimeStateSnapshot } from '../../src/ports/runtime-port.js'
import { applySdkSessionPreferences } from '../../src/runtime/service/sdk-session-runtime.js'
import type { SessionCapabilities } from '../../src/types/ws-protocol.js'

describe('SDK Session Runtime preferences', () => {
  test('defaults a first-time Session to Max when ACP advertises it', async () => {
    const setConfig = vi.fn(async () => undefined)

    await applySdkSessionPreferences({
      snapshot: snapshot(),
      capabilities: capabilities(['default', 'high', 'max']),
      setModel: vi.fn(async () => undefined),
      setMode: vi.fn(async () => undefined),
      setConfig,
    })

    expect(setConfig).toHaveBeenCalledWith('effort', 'max')
  })

  test('keeps an explicit user effort instead of applying Max', async () => {
    const setConfig = vi.fn(async () => undefined)
    const state = snapshot()
    state.runtimePreferences.config = { effort: 'high' }

    await applySdkSessionPreferences({
      snapshot: state,
      capabilities: capabilities(['default', 'high', 'max']),
      setModel: vi.fn(async () => undefined),
      setMode: vi.fn(async () => undefined),
      setConfig,
    })

    expect(setConfig).toHaveBeenCalledTimes(1)
    expect(setConfig).toHaveBeenCalledWith('effort', 'high')
  })

  test('does not invent Max for an ACP model that does not support it', async () => {
    const setConfig = vi.fn(async () => undefined)

    await applySdkSessionPreferences({
      snapshot: snapshot(),
      capabilities: capabilities(['default', 'high']),
      setModel: vi.fn(async () => undefined),
      setMode: vi.fn(async () => undefined),
      setConfig,
    })

    expect(setConfig).not.toHaveBeenCalled()
  })
})

function snapshot(): RuntimeStateSnapshot {
  return {
    agent: { id: 'agent-a', name: 'Agent', type: 'dev', runtime: 'claude', permissionLevel: 3, config: {}, systemPrompt: '', projectId: null },
    session: { id: 'session-a', agentId: 'agent-a', taskId: null, projectId: null, cwd: process.cwd(), title: null, acpSessionId: null, isPrimary: false },
    runtime: { env: {}, command: { cmd: 'unused', args: [] } },
    runtimePreferences: {},
    mcpServers: [],
    autoApprovedToolNames: [],
  }
}

function capabilities(values: string[]): SessionCapabilities {
  return {
    configOptions: [{
      id: 'effort',
      name: 'Effort',
      category: 'thought_level',
      type: 'select',
      currentValue: 'default',
      options: values.map((value) => ({ value, name: value })),
    }],
  }
}
