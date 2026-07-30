import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { acpHost } from '../../src/acp/host.ts'
import { encodeClaudeProjectPath } from '../../src/acp/claude-session-files.ts'
import { closeDatabase, initDatabase } from '../../src/store/db.ts'

let tmp = ''
let previousClaudeConfigDir: string | undefined

describe('acpHost.forkSession', () => {
  beforeEach(() => {
    tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-acp-fork-'))
    initDatabase(resolve(tmp, 'test.sqlite'))
    previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
  })

  afterEach(() => {
    closeDatabase()
    if (tmp) rmSync(tmp, { recursive: true, force: true })
    tmp = ''
    acpHost.agents.delete('agent-fork-meta-test')
    if (previousClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir
  })

  test('passes agent session meta to ACP fork requests', async () => {
    const sessionMeta = { systemPrompt: 'keep the agent prompt' }
    let forkParams: unknown

    acpHost.agents.set('agent-fork-meta-test', {
      agentId: 'agent-fork-meta-test',
      runtime: 'codex',
      runtimeEnv: {},
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

  test('materializes embedded Claude forks before returning', async () => {
    const sourceAcpSessionId = '11111111-1111-4111-8111-111111111111'
    const targetAcpSessionId = '22222222-2222-4222-8222-222222222222'
    const cwd = resolve(tmp, 'workspace')
    const configDir = resolve(tmp, 'claude')
    const projectDir = resolve(configDir, 'projects', encodeClaudeProjectPath(cwd))
    mkdirSync(projectDir, { recursive: true })
    mkdirSync(cwd, { recursive: true })
    writeFileSync(
      resolve(projectDir, `${sourceAcpSessionId}.jsonl`),
      `${JSON.stringify({ type: 'mode', sessionId: sourceAcpSessionId, cwd })}\n`,
      'utf8',
    )
    acpHost.agents.set('agent-fork-meta-test', {
      agentId: 'agent-fork-meta-test',
      runtime: 'claude',
      runtimeEnv: { CLAUDE_CONFIG_DIR: configDir },
      proc: { kill: () => undefined },
      connection: {
        signal: { aborted: false },
        unstable_forkSession: async () => ({ sessionId: targetAcpSessionId }),
        closeSession: async () => undefined,
      },
      acpSessions: new Map([['sess-source', sourceAcpSessionId]]),
      runtimeSessions: new Map(),
      sessionCapabilities: new Map(),
      state: 'running',
      lastUsedAt: Date.now(),
      activeTurnCount: 0,
      agentCapabilities: { sessionCapabilities: { fork: true } },
    } as never)

    await expect(acpHost.forkSession(
      'agent-fork-meta-test',
      'sess-source',
      'sess-target',
      { cwd },
    )).resolves.toBe(targetAcpSessionId)

    const targetJsonl = resolve(projectDir, `${targetAcpSessionId}.jsonl`)
    expect(existsSync(targetJsonl)).toBe(true)
    expect(JSON.parse(readFileSync(targetJsonl, 'utf8').trim())).toMatchObject({
      sessionId: targetAcpSessionId,
      cwd,
    })
  })
})
