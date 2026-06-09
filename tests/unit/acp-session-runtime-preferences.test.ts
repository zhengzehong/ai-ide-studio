import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { applySessionRuntimePreferences } from '../../src/acp/session-runtime-preferences.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { sessionStore } from '../../src/store/sessions.js'
import type { AgentConnection } from '../../src/acp/host-types.js'
import type { SessionCapabilities } from '../../src/types/ws-protocol.js'

let tmp = ''

beforeEach(() => {
  closeDatabase()
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-acp-session-prefs-'))
  mkdirSync(tmp, { recursive: true })
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = ''
})

function makeConnection(runtime: string, caps: SessionCapabilities): AgentConnection {
  const setModel = vi.fn(async () => ({}))
  const setMode = vi.fn(async () => ({}))
  const setConfig = vi.fn(async () => ({ configOptions: [] }))
  return {
    agentId: `agent-${runtime}`,
    runtime,
    proc: { kill: () => undefined },
    connection: {
      signal: { aborted: false },
      unstable_setSessionModel: setModel,
      setSessionMode: setMode,
      setSessionConfigOption: setConfig,
    },
    acpSessions: new Map([['sess-1', 'acp-1']]),
    runtimeSessions: new Map(),
    sessionCapabilities: new Map([['sess-1', caps]]),
    state: 'running',
    lastUsedAt: Date.now(),
    activeTurnCount: 0,
  } as unknown as AgentConnection
}

describe('applySessionRuntimePreferences', () => {
  test('defaults Codex sessions to full access when no saved mode exists', async () => {
    const agent = agentStore.create({ id: 'agent-codex', name: 'Codex', type: 'dev', runtime: 'codex' })
    const session = sessionStore.create({ agentId: agent.id })
    const conn = makeConnection('codex', {
      modes: [
        { modeId: 'agent', name: 'Agent' },
        { modeId: 'agent-full-access', name: 'Agent Full Access' },
      ],
      currentModeId: 'agent',
    })
    conn.acpSessions.set(session.id, 'acp-1')
    conn.sessionCapabilities.set(session.id, conn.sessionCapabilities.get('sess-1')!)

    await applySessionRuntimePreferences(conn, session.id)

    expect(conn.connection.setSessionMode).toHaveBeenCalledWith({ sessionId: 'acp-1', modeId: 'agent-full-access' })
    expect(conn.sessionCapabilities.get(session.id)?.currentModeId).toBe('agent-full-access')
  })

  test('defaults Claude sessions to bypass permissions only when available', async () => {
    const agent = agentStore.create({ id: 'agent-claude', name: 'Claude', type: 'dev', runtime: 'claude' })
    const session = sessionStore.create({ agentId: agent.id })
    const conn = makeConnection('claude', {
      modes: [
        { modeId: 'default', name: 'Default' },
        { modeId: 'bypassPermissions', name: 'Bypass Permissions' },
      ],
      currentModeId: 'default',
    })
    conn.acpSessions.set(session.id, 'acp-1')
    conn.sessionCapabilities.set(session.id, conn.sessionCapabilities.get('sess-1')!)

    await applySessionRuntimePreferences(conn, session.id)

    expect(conn.connection.setSessionMode).toHaveBeenCalledWith({ sessionId: 'acp-1', modeId: 'bypassPermissions' })
    expect(conn.sessionCapabilities.get(session.id)?.currentModeId).toBe('bypassPermissions')
  })

  test('keeps ACP current mode when Claude bypass is unavailable', async () => {
    const agent = agentStore.create({ id: 'agent-claude', name: 'Claude', type: 'dev', runtime: 'claude' })
    const session = sessionStore.create({ agentId: agent.id })
    const conn = makeConnection('claude', {
      modes: [{ modeId: 'default', name: 'Default' }],
      currentModeId: 'default',
    })
    conn.acpSessions.set(session.id, 'acp-1')
    conn.sessionCapabilities.set(session.id, conn.sessionCapabilities.get('sess-1')!)

    await applySessionRuntimePreferences(conn, session.id)

    expect(conn.connection.setSessionMode).not.toHaveBeenCalled()
    expect(conn.sessionCapabilities.get(session.id)?.currentModeId).toBe('default')
  })

  test('saved mode and model take precedence over runtime defaults', async () => {
    const agent = agentStore.create({ id: 'agent-codex', name: 'Codex', type: 'dev', runtime: 'codex' })
    const session = sessionStore.create({ agentId: agent.id })
    sessionStore.updateRuntimePreferences(session.id, {
      modelId: 'gpt-5-codex',
      modeId: 'agent',
      config: { effort: 'high' },
    })
    const conn = makeConnection('codex', {
      models: [
        { modelId: 'gpt-5-mini', name: 'Mini' },
        { modelId: 'gpt-5-codex', name: 'Codex' },
      ],
      currentModelId: 'gpt-5-mini',
      modes: [
        { modeId: 'agent', name: 'Agent' },
        { modeId: 'agent-full-access', name: 'Agent Full Access' },
      ],
      currentModeId: 'agent-full-access',
      configOptions: [
        {
          id: 'effort',
          name: 'Effort',
          type: 'select',
          currentValue: 'medium',
          options: [{ value: 'high', name: 'High' }],
        },
      ],
    })
    conn.acpSessions.set(session.id, 'acp-1')
    conn.sessionCapabilities.set(session.id, conn.sessionCapabilities.get('sess-1')!)

    await applySessionRuntimePreferences(conn, session.id)

    expect(conn.connection.unstable_setSessionModel).toHaveBeenCalledWith({ sessionId: 'acp-1', modelId: 'gpt-5-codex' })
    expect(conn.connection.setSessionMode).toHaveBeenCalledWith({ sessionId: 'acp-1', modeId: 'agent' })
    expect(conn.connection.setSessionConfigOption).toHaveBeenCalledWith({ sessionId: 'acp-1', configId: 'effort', value: 'high' })
    expect(conn.sessionCapabilities.get(session.id)?.currentModelId).toBe('gpt-5-codex')
    expect(conn.sessionCapabilities.get(session.id)?.currentModeId).toBe('agent')
    expect(conn.sessionCapabilities.get(session.id)?.configOptions?.find((option) => option.id === 'effort')?.currentValue).toBe('high')
  })
})
