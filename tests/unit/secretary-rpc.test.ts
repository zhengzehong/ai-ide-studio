import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createProjectSecretary } from '../../src/core/project-secretary.js'
import { secretaryRpcHandlers } from '../../src/gateway/rpc/secretary.js'
import type { RpcContext } from '../../src/gateway/rpc/types.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { secretaryRunStore } from '../../src/store/secretary-runs.js'

let root = ''

beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), 'ai-ide-secretary-rpc-'))
  initDatabase(resolve(root, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(root, { recursive: true, force: true })
})

describe('secretary history and Session RPC', () => {
  test('returns lightweight owner-scoped runs and guarded hidden Sessions', async () => {
    const project = projectStore.create({ name: 'Project', workDir: root })
    const agent = agentStore.create({ name: 'Executor', type: 'pm', runtime: 'mock', projectId: project.id })
    const secretary = await createProjectSecretary({
      projectId: project.id,
      name: '项目秘书',
      definitionPrompt: '',
      reportPrompt: '',
      executionAgentId: agent.id,
      observedAgentIds: [],
      observeAll: true,
      watchSessionDone: false,
    })
    secretaryRunStore.enqueue({
      secretaryId: secretary.id,
      eventType: 'manual',
      payload: { privateContext: 'hidden' },
      dedupeKey: 'rpc-run',
    })
    let result: unknown
    const context: RpcContext = {
      state: { authMode: 'owner', subscriptions: new Set() },
      sendResult: (value) => { result = value },
      sendError: () => undefined,
      sendOutOfBandError: () => undefined,
    }

    await secretaryRpcHandlers['secretary.runs.list']({
      type: 'secretary.runs.list', projectId: project.id, secretaryId: secretary.id, limit: 5,
    }, context)
    expect(result).toEqual([expect.objectContaining({ eventType: 'manual', status: 'pending' })])
    expect(JSON.stringify(result)).not.toContain('privateContext')

    await secretaryRpcHandlers['secretary.session.get']({
      type: 'secretary.session.get', projectId: project.id, secretaryId: secretary.id,
      sessionId: secretary.chatSessionId!,
    }, context)
    expect(result).toMatchObject({ id: secretary.chatSessionId, purpose: 'secretary_chat' })

    await expect(async () => secretaryRpcHandlers['secretary.runs.list']({
      type: 'secretary.runs.list', projectId: project.id, secretaryId: secretary.id,
    }, { ...context, state: { authMode: 'guest', subscriptions: new Set() } }))
      .rejects.toThrow('访客无权访问项目秘书')
  })
})
