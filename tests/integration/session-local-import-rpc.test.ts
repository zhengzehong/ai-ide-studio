import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { initDatabase, closeDatabase, getDb } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { dispatchRpc } from '../../src/gateway/rpc/registry.js'
import type { ClientMessage } from '../../src/types/ws-protocol.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-local-import-rpc-'))
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('local session import RPC', () => {
  test('imports a Codex JSONL as an empty platform session with acp_session_id', async () => {
    const project = projectStore.create({ name: 'Project', workDir: join(tmp, 'project') })
    const agent = agentStore.create({ name: 'Codex', type: 'dev', runtime: 'codex', projectId: project.id })
    const jsonlPath = join(tmp, 'rollout-2026-06-11T01-00-00-019codex.jsonl')
    writeFileSync(jsonlPath, JSON.stringify({
      type: 'session_meta',
      payload: { id: '019codex-session', cwd: project.work_dir },
    }), 'utf-8')

    const rpc = createRpc()
    await rpc.send({
      type: 'sessions.importLocal',
      agentId: agent.id,
      projectId: project.id,
      jsonlPath,
    })

    const response = rpc.last()
    expect(response.type).toBe('result')
    const data = asRecord(response.data)
    const session = asRecord(data.session)
    expect(session.agent_id).toBe(agent.id)
    expect(session.project_id).toBe(project.id)
    expect(session.acp_session_id).toBe('019codex-session')
    expect(data.warning).toBeNull()
    expect(countRows('messages')).toBe(0)
    expect(countRows('session_events')).toBe(0)
  })

  test('returns a cwd warning while still importing when JSONL cwd differs', async () => {
    const project = projectStore.create({ name: 'Project', workDir: join(tmp, 'project') })
    const agent = agentStore.create({ name: 'Claude', type: 'dev', runtime: 'claude', projectId: project.id })
    const jsonlPath = join(tmp, 'f4f82d42-6954-4723-9cab-7e97d0c6068d.jsonl')
    writeFileSync(jsonlPath, JSON.stringify({
      sessionId: 'f4f82d42-6954-4723-9cab-7e97d0c6068d',
      cwd: join(tmp, 'other-project'),
    }), 'utf-8')

    const rpc = createRpc()
    await rpc.send({
      type: 'sessions.importLocal',
      agentId: agent.id,
      projectId: project.id,
      jsonlPath,
    })

    const data = asRecord(rpc.last().data)
    expect(asRecord(data.session).acp_session_id).toBe('f4f82d42-6954-4723-9cab-7e97d0c6068d')
    expect(data.warning).toContain('工作目录')
  })

  test('rejects runtime mismatches without creating a session', async () => {
    const project = projectStore.create({ name: 'Project', workDir: join(tmp, 'project') })
    const agent = agentStore.create({ name: 'Claude', type: 'dev', runtime: 'claude', projectId: project.id })
    const jsonlPath = join(tmp, 'rollout-2026-06-11T01-00-00-019codex.jsonl')
    writeFileSync(jsonlPath, JSON.stringify({
      type: 'session_meta',
      payload: { id: '019codex-session', cwd: project.work_dir },
    }), 'utf-8')

    const rpc = createRpc()
    await rpc.send({
      type: 'sessions.importLocal',
      agentId: agent.id,
      projectId: project.id,
      jsonlPath,
    })

    expect(rpc.last().type).toBe('error')
    expect(rpc.last().message).toContain('runtime')
    expect(countRows('sessions')).toBe(0)
  })

  test('rejects selected candidate runtime mismatches without creating a session', async () => {
    const project = projectStore.create({ name: 'Project', workDir: join(tmp, 'project') })
    const agent = agentStore.create({ name: 'Claude', type: 'dev', runtime: 'claude', projectId: project.id })

    const rpc = createRpc()
    await rpc.send({
      type: 'sessions.importLocal',
      agentId: agent.id,
      projectId: project.id,
      externalSessionId: '019codex-session',
      runtime: 'codex',
      sourcePath: join(tmp, 'rollout.jsonl'),
    })

    expect(rpc.last().type).toBe('error')
    expect(rpc.last().message).toContain('runtime')
    expect(countRows('sessions')).toBe(0)
  })

  test('lists local import candidates for the selected runtime and project', async () => {
    const project = projectStore.create({ name: 'Project', workDir: 'D:/repo/project' })
    const agent = agentStore.create({ name: 'Claude', type: 'dev', runtime: 'claude', projectId: project.id })
    const claudeHome = join(tmp, '.claude')
    const projectDir = join(claudeHome, 'projects', 'D--repo-project')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(
      join(projectDir, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jsonl'),
      JSON.stringify({
        sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        cwd: 'D:/repo/project',
      }),
      'utf-8',
    )

    const rpc = createRpc()
    await rpc.send({
      type: 'sessions.listLocalImportCandidates',
      agentId: agent.id,
      projectId: project.id,
      claudeHome,
    })

    const candidates = asRecords(rpc.last().data)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      runtime: 'claude',
      sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      cwd: 'D:/repo/project',
    })
  })
})

function createRpc(): {
  send: (msg: ClientMessage) => Promise<void>
  last: () => { type?: string; data?: unknown; message?: string }
} {
  const sent: Array<{ type?: string; data?: unknown; message?: string }> = []
  return {
    async send(msg) {
      const context = {
        state: { subscriptions: new Set() },
        sendResult: (data: unknown) => sent.push({ type: 'result', data }),
        sendError: (message: string) => sent.push({ type: 'error', message }),
        sendOutOfBandError: (message: string) => sent.push({ type: 'error', message }),
      }
      try {
        await dispatchRpc(msg, context)
      } catch (err) {
        context.sendError(err instanceof Error ? err.message : String(err))
      }
    },
    last: () => sent.at(-1) ?? {},
  }
}

function countRows(table: string): number {
  return getDb().prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object')
  return value as Record<string, unknown>
}

function asRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('expected array')
  return value.map(asRecord)
}
