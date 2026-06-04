import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { acpHost } from '../../src/acp/host.ts'
import { closeDatabase, initDatabase } from '../../src/store/db.ts'

let tmp = ''

describe('acpHost.forkSession', () => {
  beforeEach(() => {
    tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-acp-fork-'))
    initDatabase(resolve(tmp, 'test.sqlite'))
  })

  afterEach(() => {
    closeDatabase()
    if (tmp) rmSync(tmp, { recursive: true, force: true })
    tmp = ''
    acpHost.agents.delete('agent-fork-meta-test')
  })

  test('passes agent session meta to ACP fork requests', async () => {
    const sessionMeta = { systemPrompt: 'keep the agent prompt' }
    let forkParams: unknown

    acpHost.agents.set('agent-fork-meta-test', {
      agentId: 'agent-fork-meta-test',
      runtime: 'codex',
      proc: { kill: () => undefined },
      connection: {
        signal: { aborted: false },
        unstable_forkSession: async (params: unknown) => {
          forkParams = params
          return { sessionId: 'acp-target', models: null, modes: null }
        },
      },
      acpSessions: new Map([['sess-source', 'acp-source']]),
      runtimeSessions: new Map(),
      sessionCapabilities: new Map(),
      state: 'running',
      lastUsedAt: Date.now(),
      activeTurnCount: 0,
      agentCapabilities: { sessionCapabilities: { fork: true } },
      sessionMeta,
    } as never)

    await acpHost.forkSession('agent-fork-meta-test', 'sess-source', 'sess-target', { cwd: 'D:\\repo' })

    expect(forkParams).toMatchObject({
      sessionId: 'acp-source',
      cwd: 'D:\\repo',
      _meta: sessionMeta,
    })
  })
})
