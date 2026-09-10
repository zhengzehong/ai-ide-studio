import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import type * as acp from '@agentclientprotocol/sdk'
import { describe, expect, test, vi } from 'vitest'
import type { RuntimeStateSnapshot } from '../../src/ports/runtime-port.js'
import { RuntimeSessionActorScheduler } from '../../src/runtime/actors/session-actor.js'
import type { AcpRuntimeClientRouter } from '../../src/runtime/service/acp-runtime-client.js'
import { SdkRuntimeHost } from '../../src/runtime/service/sdk-runtime-host.js'

describe('Codex fork subscription readiness', () => {
  test('restores events before caching, preserves preferences and routes the first prompt', async () => {
    const h = harness()
    const state = snapshot('fork')
    state.runtimePreferences = { modelId: 'model-b', modeId: 'agent-full-access', config: { reasoning_effort: 'high' } }
    expect(await h.host.forkSession(state, 'native-source')).toBe('native-fork')
    expect(h.resume).toHaveBeenCalledWith({ sessionId: 'native-fork', cwd: state.session.cwd, mcpServers: [], _meta: state.runtime.sessionMeta })
    expect(h.host.getSessionCapabilities('agent', 'fork')).toMatchObject({ currentModelId: 'model-b', currentModeId: 'agent-full-access' })
    expect(h.model).toHaveBeenCalledWith({ sessionId: 'native-fork', modelId: 'model-b' })
    expect(h.mode).toHaveBeenCalledWith({ sessionId: 'native-fork', modeId: 'agent-full-access' })
    expect(h.config).toHaveBeenCalledWith({ sessionId: 'native-fork', configId: 'reasoning_effort', value: 'high' })
    await h.host.ensureSession(state)
    expect(h.resume).toHaveBeenCalledOnce()
    await h.host.prompt({ agentId: 'agent', sessionId: 'fork', content: 'hello', diagnostics: { messageId: 'message-fork', turnId: 'turn-fork' } })
    expect(h.publishUpdate).toHaveBeenCalledWith('agent', expect.objectContaining({ sessionId: 'fork', messageId: 'message-fork', data: expect.objectContaining({ contentDelta: 'OK' }) }))
    expect(h.publishUpdate).toHaveBeenCalledWith('agent', expect.objectContaining({ sessionId: 'fork', data: expect.objectContaining({ toolCall: expect.objectContaining({ id: 'tool-1' }) }) }))
    expect(h.publishUpdate).toHaveBeenCalledWith('agent', expect.objectContaining({ sessionId: 'fork', data: expect.objectContaining({ toolCallUpdate: expect.objectContaining({ id: 'tool-1', status: 'completed' }) }) }))
    expect(h.publishDone).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'fork', messageId: 'message-fork', stopReason: 'end_turn' }))
    expect(h.clone).not.toHaveBeenCalled()
    await h.host.close()
  })

  test('does not expose a fork while resume is pending; a sibling can still run', async () => {
    const h = harness()
    await h.host.ensureSession(snapshot('source'))
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    h.resume.mockImplementationOnce(async () => { await gate; h.subscribed.add('native-fork'); return capabilities() })
    const fork = h.host.forkSession(snapshot('fork'), 'native-source')
    await vi.waitFor(() => expect(h.resume).toHaveBeenCalledOnce())
    expect(h.host.hasSession('fork')).toBe(false)
    await h.host.prompt({ agentId: 'agent', sessionId: 'source', content: 'hello' })
    expect(h.publishDone).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'source' }))
    release?.()
    await fork
    expect(h.host.hasSession('fork')).toBe(true)
    await h.host.close()
  })

  test.each(['resume failed', 'thread not found: native-fork'])('cleans up failed fork without losing source or replacing history: %s', async (message) => {
    const h = harness()
    await h.host.ensureSession(snapshot('source'))
    h.resume.mockRejectedValueOnce(new Error(message))
    const fork = snapshot('fork')
    fork.session.canRecreateMissingSession = true
    await expect(h.host.forkSession(fork, 'native-source')).rejects.toThrow()
    expect(h.host.hasSession('fork')).toBe(false)
    expect(h.close).toHaveBeenCalledWith({ sessionId: 'native-fork' })
    expect(h.newSession).toHaveBeenCalledOnce()
    expect(fork.session.canRecreateMissingSession).toBe(true)
    expect(h.host.hasSession('source')).toBe(true)
    await h.host.prompt({ agentId: 'agent', sessionId: 'source', content: 'hello' })
    expect(h.publishDone).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'source' }))
    await h.host.close()
  })

  test('retains the restore error if closing the failed fork also fails', async () => {
    const h = harness()
    h.resume.mockRejectedValueOnce(new Error('restore failed'))
    h.close.mockRejectedValueOnce(new Error('close failed'))
    await expect(h.host.forkSession(snapshot('fork'), 'native-source')).rejects.toThrow('restore failed')
    expect(h.host.hasSession('fork')).toBe(false)
    await h.host.close()
  })

  test('supports load fallback when resume is not advertised', async () => {
    const h = harness({ loadOnly: true })
    await h.host.forkSession(snapshot('fork'), 'native-source')
    expect(h.load).toHaveBeenCalledOnce()
    expect(h.resume).not.toHaveBeenCalled()
    await h.host.prompt({ agentId: 'agent', sessionId: 'fork', content: 'hello' })
    expect(h.publishDone).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'fork' }))
    await h.host.close()
  })

  test('rejects without resume/load support instead of silently creating an empty copy', async () => {
    const h = harness({ noRestore: true })
    await expect(h.host.forkSession(snapshot('fork'), 'native-source')).rejects.toThrow()
    expect(h.newSession).not.toHaveBeenCalled()
    expect(h.host.hasSession('fork')).toBe(false)
    expect(h.close).toHaveBeenCalledWith({ sessionId: 'native-fork' })
    await h.host.close()
  })

  test('keeps Claude file materialization without introducing a resume', async () => {
    const h = harness()
    const state = snapshot('fork')
    state.agent.runtime = 'claude'
    await h.host.forkSession(state, 'native-source')
    expect(h.clone).toHaveBeenCalledOnce()
    expect(h.resume).not.toHaveBeenCalled()
    expect(h.host.hasSession('fork')).toBe(true)
    await h.host.close()
  })
})

function capabilities(): acp.ResumeSessionResponse {
  return {
    models: { currentModelId: 'model-a', availableModels: [{ modelId: 'model-a', name: 'A' }, { modelId: 'model-b', name: 'B' }] },
    modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }, { id: 'agent-full-access', name: 'Full' }] },
    configOptions: [{ id: 'reasoning_effort', name: 'Effort', type: 'select', currentValue: 'low', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] }],
  }
}

function harness(options: { loadOnly?: boolean; noRestore?: boolean } = {}): {
  host: SdkRuntimeHost
  subscribed: Set<string>
  resume: ReturnType<typeof vi.fn<() => Promise<acp.ResumeSessionResponse>>>
  load: ReturnType<typeof vi.fn<() => Promise<acp.ResumeSessionResponse>>>
  newSession: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn<() => Promise<void>>>
  clone: ReturnType<typeof vi.fn>
  model: ReturnType<typeof vi.fn>
  mode: ReturnType<typeof vi.fn>
  config: ReturnType<typeof vi.fn>
  publishUpdate: ReturnType<typeof vi.fn>
  publishDone: ReturnType<typeof vi.fn>
} {
  const subscribed = new Set<string>()
  let router: AcpRuntimeClientRouter
  const resume = vi.fn(async (): Promise<acp.ResumeSessionResponse> => { subscribed.add('native-fork'); return capabilities() })
  const load = vi.fn(async (): Promise<acp.ResumeSessionResponse> => { subscribed.add('native-fork'); return capabilities() })
  const newSession = vi.fn(async () => { subscribed.add('native-source'); return { sessionId: 'native-source', ...capabilities() } })
  const close = vi.fn(async (): Promise<void> => undefined)
  const clone = vi.fn(async () => ({ jsonlPath: 'test.jsonl', lineCount: 1, resourceFilesCopied: 0 }))
  const model = vi.fn(async () => undefined)
  const mode = vi.fn(async () => undefined)
  const config = vi.fn(async () => ({ configOptions: [] }))
  const publishUpdate = vi.fn()
  const publishDone = vi.fn(async () => undefined)
  const host = new SdkRuntimeHost(new RuntimeSessionActorScheduler(), { publishUpdate, publishDone }, {
    cloneClaudeSessionFiles: clone,
    hasClaudeSessionFiles: async () => true,
    startAgent: async (input) => {
      router = input.router
      return {
        process: Object.assign(new EventEmitter(), { kill: vi.fn(() => true) }) as unknown as ChildProcess,
        agentCapabilities: { sessionCapabilities: { fork: {}, ...(!options.loadOnly && !options.noRestore ? { resume: {} } : {}) }, loadSession: options.loadOnly },
        connection: {
          newSession, resumeSession: resume, loadSession: load, closeSession: close,
          unstable_forkSession: async () => { subscribed.delete('native-fork'); return { sessionId: 'native-fork' } },
          unstable_setSessionModel: model, setSessionMode: mode, setSessionConfigOption: config,
          prompt: async ({ sessionId }: { sessionId: string }) => {
            if (!subscribed.has(sessionId)) throw new Error('Missing event subscription')
            await router.client.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'OK' } } })
            await router.client.sessionUpdate({ sessionId, update: { sessionUpdate: 'tool_call', toolCallId: 'tool-1', title: 'Read', status: 'in_progress' } })
            await router.client.sessionUpdate({ sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: 'completed' } })
            return { stopReason: 'end_turn' }
          },
        } as unknown as acp.ClientSideConnection,
      }
    },
  })
  return { host, subscribed, resume, load, newSession, close, clone, model, mode, config, publishUpdate, publishDone }
}

function snapshot(id: string): RuntimeStateSnapshot {
  return {
    agent: { id: 'agent', name: 'Agent', type: 'dev', runtime: 'codex', permissionLevel: 3, config: {}, systemPrompt: '', projectId: 'project' },
    session: { id, agentId: 'agent', taskId: null, projectId: 'project', cwd: process.cwd(), title: null, acpSessionId: null, isPrimary: false },
    runtime: { env: {}, command: { cmd: 'unused', args: [] }, sessionMeta: { test: true } },
    runtimePreferences: { modeId: 'default' }, mcpServers: [], autoApprovedToolNames: [],
  }
}
