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

  test('applies a Codex profile model while inheriting the current effort', async () => {
    const state = snapshot()
    state.agent.runtime = 'codex'
    state.runtime.appliedModelProfile = {
      id: 'profile-a',
      name: 'Codex profile',
      runtime: 'codex',
      providerId: 'provider-a',
      modelId: 'gpt-5.6-sol',
    }
    const setModel = vi.fn(async () => undefined)

    await applySdkSessionPreferences({
      snapshot: state,
      capabilities: {
        models: [
          { modelId: 'system-model[high]', name: 'System' },
          { modelId: 'gpt-5.6-sol[low]', name: 'GPT low' },
          { modelId: 'gpt-5.6-sol[high]', name: 'GPT high' },
          { modelId: 'gpt-5.6-sol[xhigh]', name: 'GPT xhigh' },
        ],
        currentModelId: 'system-model[high]',
      },
      setModel,
      setMode: vi.fn(async () => undefined),
      setConfig: vi.fn(async () => undefined),
    })

    expect(setModel).toHaveBeenCalledWith('gpt-5.6-sol[high]')
  })

  test('applies explicit Codex profile effort but keeps a Session model override authoritative', async () => {
    const state = snapshot()
    state.agent.runtime = 'codex'
    state.runtime.appliedModelProfile = {
      id: 'profile-a',
      name: 'Codex profile',
      runtime: 'codex',
      providerId: 'provider-a',
      modelId: 'gpt-5.6-sol',
      effort: 'xhigh',
    }
    state.runtimePreferences.modelId = 'session-model[low]'
    const setModel = vi.fn(async () => undefined)

    await applySdkSessionPreferences({
      snapshot: state,
      capabilities: {
        models: [
          { modelId: 'gpt-5.6-sol[xhigh]', name: 'Profile' },
          { modelId: 'session-model[low]', name: 'Session' },
        ],
        currentModelId: 'system-model[medium]',
      },
      setModel,
      setMode: vi.fn(async () => undefined),
      setConfig: vi.fn(async () => undefined),
    })

    expect(setModel).toHaveBeenCalledOnce()
    expect(setModel).toHaveBeenCalledWith('session-model[low]')
  })

  test('applies explicit Codex profile effort without inventing an unsupported config option', async () => {
    const state = snapshot()
    state.agent.runtime = 'codex'
    state.runtime.appliedModelProfile = {
      id: 'profile-a',
      name: 'Codex profile',
      runtime: 'codex',
      providerId: 'provider-a',
      modelId: 'gpt-5.6-sol',
      effort: 'xhigh',
    }
    const setModel = vi.fn(async () => undefined)
    const setConfig = vi.fn(async () => undefined)

    await applySdkSessionPreferences({
      snapshot: state,
      capabilities: {
        models: [{ modelId: 'gpt-5.6-sol[xhigh]', name: 'Profile' }],
        currentModelId: 'system-model[medium]',
      },
      setModel,
      setMode: vi.fn(async () => undefined),
      setConfig,
    })

    expect(setModel).toHaveBeenCalledWith('gpt-5.6-sol[xhigh]')
    expect(setConfig).not.toHaveBeenCalled()
  })

  test('uses the independent reasoning_effort option with a bare Codex model', async () => {
    const state = snapshot()
    state.agent.runtime = 'codex'
    state.runtime.appliedModelProfile = { id: 'profile-a', name: 'Codex profile', runtime: 'codex', providerId: 'provider-a', modelId: 'gpt-5.6-sol', effort: 'high' }
    const setModel = vi.fn(async () => undefined)
    const setConfig = vi.fn(async () => undefined)

    await applySdkSessionPreferences({
      snapshot: state,
      capabilities: {
        models: [{ modelId: 'gpt-5.6-sol', name: 'Profile' }],
        currentModelId: 'other-model',
        configOptions: [{ id: 'reasoning_effort', name: 'Reasoning effort', type: 'select', currentValue: 'medium', options: [{ value: 'high', name: 'High' }] }],
      },
      setModel,
      setMode: vi.fn(async () => undefined),
      setConfig,
    })

    expect(setModel).toHaveBeenCalledWith('gpt-5.6-sol')
    expect(setConfig).toHaveBeenCalledWith('reasoning_effort', 'high')
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
