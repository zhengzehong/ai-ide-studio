import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { acpHost } from '../../src/acp/host.ts'
import { closeDatabase, initDatabase } from '../../src/store/db.ts'
import { agentStore } from '../../src/store/agents.ts'
import { sessionStore } from '../../src/store/sessions.ts'

let tmp = ''
let dynamicAgentId = ''

describe('acpHost session context refresh', () => {
  afterEach(() => {
    closeDatabase()
    if (tmp) rmSync(tmp, { recursive: true, force: true })
    tmp = ''
    acpHost.agents.delete('agent-context-refresh')
    if (dynamicAgentId) acpHost.agents.delete(dynamicAgentId)
    dynamicAgentId = ''
    vi.restoreAllMocks()
  })

  test('refreshes an already connected ACP session when project context changes', async () => {
    tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-acp-context-refresh-'))
    initDatabase(resolve(tmp, 'test.sqlite'))
    const resumeSession = vi.fn(async () => ({ models: null, modes: null }))
    const startAgent = vi.spyOn(acpHost, 'startAgent').mockResolvedValue(undefined)
    acpHost.agents.set('agent-context-refresh', {
      agentId: 'agent-context-refresh',
      runtime: 'claude',
      proc: { kill: () => undefined },
      connection: {
        signal: { aborted: false },
        resumeSession,
      },
      acpSessions: new Map([['sess-global', 'acp-global']]),
      runtimeSessions: new Map([
        [
          'sess-global',
          {
            ourSessionId: 'sess-global',
            acpSessionId: 'acp-global',
            state: 'connected',
            contextKey: JSON.stringify({ projectId: null, cwd: 'D:/global' }),
            lastUsedAt: Date.now(),
            activeTurnCount: 0,
            nextTurnKey: 0,
          },
        ],
      ]),
      sessionCapabilities: new Map(),
      state: 'running',
      lastUsedAt: Date.now(),
      activeTurnCount: 0,
      agentCapabilities: { sessionCapabilities: { resume: true } },
    } as never)

    const acpSessionId = await acpHost.ensureSession('agent-context-refresh', 'sess-global', null, {
      projectId: 'proj-current',
      cwd: 'D:/global',
    })

    expect(acpSessionId).toBe('acp-global')
    expect(startAgent).toHaveBeenCalledWith('agent-context-refresh')
    expect(resumeSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'acp-global',
      cwd: 'D:/global',
    }))
  })

  test('reuses an already connected ACP session when context is unchanged', async () => {
    tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-acp-context-reuse-'))
    initDatabase(resolve(tmp, 'test.sqlite'))
    const resumeSession = vi.fn(async () => ({ models: null, modes: null }))
    vi.spyOn(acpHost, 'startAgent').mockResolvedValue(undefined)
    acpHost.agents.set('agent-context-refresh', {
      agentId: 'agent-context-refresh',
      runtime: 'claude',
      proc: { kill: () => undefined },
      connection: {
        signal: { aborted: false },
        resumeSession,
      },
      acpSessions: new Map([['sess-global', 'acp-global']]),
      runtimeSessions: new Map([
        [
          'sess-global',
          {
            ourSessionId: 'sess-global',
            acpSessionId: 'acp-global',
            state: 'connected',
            contextKey: JSON.stringify({ projectId: 'proj-current', cwd: 'D:/global' }),
            lastUsedAt: Date.now(),
            activeTurnCount: 0,
            nextTurnKey: 0,
          },
        ],
      ]),
      sessionCapabilities: new Map(),
      state: 'running',
      lastUsedAt: Date.now(),
      activeTurnCount: 0,
      agentCapabilities: { sessionCapabilities: { resume: true } },
    } as never)

    const acpSessionId = await acpHost.ensureSession('agent-context-refresh', 'sess-global', null, {
      projectId: 'proj-current',
      cwd: 'D:/global',
    })

    expect(acpSessionId).toBe('acp-global')
    expect(resumeSession).not.toHaveBeenCalled()
  })

  test('refreshes an existing Session with the latest Agent system prompt', async () => {
    tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-acp-prompt-refresh-'))
    initDatabase(resolve(tmp, 'test.sqlite'))
    const agent = agentStore.create({
      name: 'Prompt Agent',
      type: 'developer',
      runtime: 'claude',
      systemPrompt: 'old prompt',
    })
    dynamicAgentId = agent.id
    const session = sessionStore.create({ agentId: agent.id })
    const resumeSession = vi.fn(async () => ({ models: null, modes: null }))
    vi.spyOn(acpHost, 'startAgent').mockResolvedValue(undefined)
    acpHost.agents.set(agent.id, {
      agentId: agent.id,
      runtime: 'claude',
      runtimeEnv: {},
      agent,
      sessionMeta: { systemPrompt: 'old prompt' },
      proc: { kill: () => undefined },
      connection: {
        signal: { aborted: false },
        resumeSession,
      },
      acpSessions: new Map([[session.id, 'acp-existing']]),
      runtimeSessions: new Map([
        [
          session.id,
          {
            ourSessionId: session.id,
            acpSessionId: 'acp-existing',
            state: 'connected',
            contextKey: JSON.stringify({
              projectId: null,
              cwd: 'D:/workspace',
              runtimeContextKey: 'prompt-old',
            }),
            lastUsedAt: Date.now(),
            activeTurnCount: 0,
            nextTurnKey: 0,
          },
        ],
      ]),
      sessionCapabilities: new Map(),
      state: 'running',
      lastUsedAt: Date.now(),
      activeTurnCount: 0,
      agentCapabilities: { sessionCapabilities: { resume: true } },
    } as never)
    agentStore.update(agent.id, { systemPrompt: 'new prompt for the next turn' })

    await acpHost.ensureSession(agent.id, session.id, 'acp-existing', {
      cwd: 'D:/workspace',
      runtimeContextKey: 'prompt-new',
    })

    expect(resumeSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'acp-existing',
      _meta: expect.objectContaining({ systemPrompt: expect.anything() }),
    }))
    expect(JSON.stringify(resumeSession.mock.calls[0]?.[0]?._meta)).toContain('new prompt for the next turn')
  })

  test('recreates one missing provisional Session in embedded Runtime', async () => {
    initRecoveryDatabase('recover')
    const harness = installRecoveryAgent(new Error('Resource not found: acp-stale'))

    const acpSessionId = await acpHost.ensureSession(
      'agent-context-refresh',
      'sess-recovery',
      'acp-stale',
      { cwd: 'D:/workspace', canRecreateMissingSession: true },
    )

    expect(acpSessionId).toBe('acp-new')
    expect(harness.resumeSession).toHaveBeenCalledOnce()
    expect(harness.newSession).toHaveBeenCalledOnce()
  })

  test('blocks embedded recreation when the platform Session has materialized history', async () => {
    initRecoveryDatabase('historical')
    const harness = installRecoveryAgent(new Error('Resource not found: acp-stale'))

    await expect(acpHost.ensureSession(
      'agent-context-refresh',
      'sess-recovery',
      'acp-stale',
      { cwd: 'D:/workspace', canRecreateMissingSession: false },
    )).rejects.toThrow('底层 Agent 会话历史已丢失')

    expect(harness.newSession).not.toHaveBeenCalled()
  })

  test('requires an exact stale Session ID before embedded recreation', async () => {
    initRecoveryDatabase('exact-id')
    const harness = installRecoveryAgent(new Error('Resource not found: acp-stale-other'))

    await expect(acpHost.ensureSession(
      'agent-context-refresh',
      'sess-recovery',
      'acp-stale',
      { cwd: 'D:/workspace', canRecreateMissingSession: true },
    )).rejects.toThrow('Resource not found: acp-stale-other')

    expect(harness.newSession).not.toHaveBeenCalled()
  })
})

function initRecoveryDatabase(name: string): void {
  tmp = mkdtempSync(resolve(tmpdir(), `ai-ide-acp-${name}-`))
  initDatabase(resolve(tmp, 'test.sqlite'))
}

function installRecoveryAgent(resumeError: Error): {
  resumeSession: ReturnType<typeof vi.fn>
  newSession: ReturnType<typeof vi.fn>
} {
  const resumeSession = vi.fn(async () => {
    throw resumeError
  })
  const newSession = vi.fn(async () => ({ sessionId: 'acp-new', models: null, modes: null }))
  vi.spyOn(acpHost, 'startAgent').mockResolvedValue(undefined)
  acpHost.agents.set('agent-context-refresh', {
    agentId: 'agent-context-refresh',
    runtime: 'claude',
    runtimeEnv: {},
    proc: { kill: () => undefined },
    connection: {
      signal: { aborted: false },
      resumeSession,
      newSession,
    },
    acpSessions: new Map(),
    runtimeSessions: new Map(),
    sessionCapabilities: new Map(),
    state: 'running',
    lastUsedAt: Date.now(),
    activeTurnCount: 0,
    agentCapabilities: { sessionCapabilities: { resume: true } },
  } as never)
  return { resumeSession, newSession }
}
