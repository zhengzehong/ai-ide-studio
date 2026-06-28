import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { acpHost } from '../../src/acp/host.ts'
import { closeDatabase, initDatabase } from '../../src/store/db.ts'

let tmp = ''

describe('acpHost session context refresh', () => {
  afterEach(() => {
    closeDatabase()
    if (tmp) rmSync(tmp, { recursive: true, force: true })
    tmp = ''
    acpHost.agents.delete('agent-context-refresh')
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
})
