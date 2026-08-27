import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { inspirationRpcHandlers } from '../../src/gateway/rpc/inspiration.js'
import type { RpcAuthMode, RpcContext } from '../../src/gateway/rpc/types.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'

const root = mkdtempSync(resolve(tmpdir(), 'ai-ide-inspiration-rpc-'))
let index = 0

beforeEach(() => {
  closeDatabase()
  const dir = resolve(root, `case-${++index}`)
  mkdirSync(dir, { recursive: true })
  initDatabase(resolve(dir, 'test.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  closeDatabase()
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('inspiration RPC', () => {
  test('rejects guest access', async () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    await expect(call('inspiration.get', { projectId: project.id }, 'guest')).rejects.toThrow('访客无权访问项目灵感')
  })

  test('configures a project and saves a draft without starting AI', async () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const agent = agentStore.create({ type: 'pm', name: 'A', runtime: 'mock', projectId: project.id })
    const config = await call('inspiration.configure', {
      projectId: project.id,
      organizerAgentId: agent.id,
      autoOrganize: false,
    }) as { sessionId: string }
    const note = await call('inspiration.note.create', {
      projectId: project.id,
      title: '记录',
      sourceMarkdown: '先保存，不整理',
    }) as { status: string }

    expect(config.sessionId).toBeTruthy()
    expect(note.status).toBe('draft')
  })

  test('clears project task defaults when the client sends null', async () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const agent = agentStore.create({ type: 'pm', name: 'A', runtime: 'mock', projectId: project.id })
    const targetSession = sessionStore.create({ agentId: agent.id, projectId: project.id })
    await call('inspiration.configure', {
      projectId: project.id,
      organizerAgentId: agent.id,
      taskDefaultAgentId: agent.id,
      taskDefaultSessionId: targetSession.id,
    })

    const cleared = await call('inspiration.configure', {
      projectId: project.id,
      organizerAgentId: agent.id,
      taskDefaultAgentId: null,
      taskDefaultSessionId: null,
    }) as { taskDefaultAgentId: string | null; taskDefaultSessionId: string | null }

    expect(cleared.taskDefaultAgentId).toBeNull()
    expect(cleared.taskDefaultSessionId).toBeNull()
  })

  test('does not allow a note to be read through another project', async () => {
    const first = projectStore.create({ name: 'A', workDir: root })
    const second = projectStore.create({ name: 'B', workDir: root })
    const note = await call('inspiration.note.create', {
      projectId: first.id,
      title: '私有记录',
      sourceMarkdown: '只属于 A',
    }) as { id: string }

    await expect(call('inspiration.note.get', { projectId: second.id, noteId: note.id }))
      .rejects.toThrow('灵感不存在或不属于当前项目')
  })

  test('marks a note complete within its project', async () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const note = await call('inspiration.note.create', {
      projectId: project.id,
      title: '待处理',
      sourceMarkdown: '稍后处理',
    }) as { id: string }

    const completed = await call('inspiration.note.setCompleted', {
      projectId: project.id, noteId: note.id, completed: true,
    }) as { completedAt: string | null }
    expect(completed.completedAt).toEqual(expect.any(String))
    const reopened = await call('inspiration.note.setCompleted', {
      projectId: project.id, noteId: note.id, completed: false,
    }) as { completedAt: string | null }
    expect(reopened.completedAt).toBeNull()
  })
})

async function call(type: string, message: Record<string, unknown>, authMode: RpcAuthMode = 'owner'): Promise<unknown> {
  const handler = inspirationRpcHandlers[type]
  if (!handler) throw new Error(`missing handler: ${type}`)
  let result: unknown
  const context: RpcContext = {
    state: { subscriptions: new Set(), authMode },
    sendResult: (value) => { result = value },
    sendError: (message) => { throw new Error(message) },
    sendOutOfBandError: (message) => { throw new Error(message) },
  }
  await handler({ type, ...message }, context)
  return result
}
