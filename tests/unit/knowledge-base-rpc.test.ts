import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { knowledgeBaseService } from '../../src/core/knowledge-base.js'
import { knowledgeBaseRpcHandlers } from '../../src/gateway/rpc/knowledge-base.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-kb-rpc-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('knowledge base RPC handlers', () => {
  test('lists knowledge bases, pages, page detail, and activities', async () => {
    const project = projectStore.create({ name: 'AI IDE', workDir: tmp })
    const projectKb = knowledgeBaseService.ensureProjectKnowledgeBase(project.id)
    const shared = knowledgeBaseService.createKnowledgeBase({
      name: 'Shared Standards',
      kind: 'shared',
      src: 'manual',
      actor: 'human',
      actorType: 'human',
      tool: 'manual',
    })
    const created = knowledgeBaseService.createPage({
      projectId: project.id,
      kbId: projectKb.id,
      title: 'Workspace State',
      body: 'Workspace reads [[Agent State]].',
      actor: 'agent-a',
      actorType: 'ai',
      tool: 'core.kb.create_page',
    })

    const listed = await callKnowledgeRpc('knowledgeBases.list', { type: 'knowledgeBases.list', projectId: project.id }) as Record<string, unknown>
    expect(asRecords(listed.knowledgeBases).map((kb) => kb.id)).toContain(projectKb.id)

    const sharedList = await callKnowledgeRpc('knowledgeBases.shared', { type: 'knowledgeBases.shared' }) as Record<string, unknown>
    expect(asRecords(sharedList.knowledgeBases).map((kb) => kb.id)).toContain(shared.id)

    const pages = await callKnowledgeRpc('knowledgePages.list', {
      type: 'knowledgePages.list',
      projectId: project.id,
      kbId: projectKb.id,
    }) as Record<string, unknown>
    expect(asRecords(pages.pages).map((page) => page.id)).toContain(created.page.id)

    const detail = await callKnowledgeRpc('knowledgePages.read', {
      type: 'knowledgePages.read',
      projectId: project.id,
      pageId: created.page.id,
    }) as Record<string, unknown>
    expect(asRecord(detail.page)).toMatchObject({ id: created.page.id })
    expect(asRecords(detail.outLinks)[0]).toMatchObject({ title: 'Agent State', status: 'missing' })

    const activities = await callKnowledgeRpc('knowledgeActivities.list', {
      type: 'knowledgeActivities.list',
      projectId: project.id,
      kbId: projectKb.id,
    }) as Record<string, unknown>
    expect(asRecords(activities.activities).map((activity) => activity.act)).toContain('create')
  })

  test('creates, updates, and reverts pages through human RPC actions', async () => {
    const project = projectStore.create({ name: 'AI IDE', workDir: tmp })
    const projectKb = knowledgeBaseService.ensureProjectKnowledgeBase(project.id)

    const created = await callKnowledgeRpc('knowledgePages.create', {
      type: 'knowledgePages.create',
      projectId: project.id,
      kbId: projectKb.id,
      title: 'Human Note',
      body: 'Initial note',
    }) as Record<string, unknown>
    const page = asRecord(created.page)
    expect(page).toMatchObject({ author: 'human', by: 'human' })

    const updated = await callKnowledgeRpc('knowledgePages.update', {
      type: 'knowledgePages.update',
      projectId: project.id,
      pageId: page.id,
      body: 'Updated note',
    }) as Record<string, unknown>
    expect(asRecord(updated.page)).toMatchObject({ body: 'Updated note', author: 'human' })

    const reverted = await callKnowledgeRpc('knowledgeActivities.revert', {
      type: 'knowledgeActivities.revert',
      projectId: project.id,
      activityId: asRecord(updated.activity).id,
    }) as Record<string, unknown>
    expect(asRecord(reverted.page).body).toBe('Initial note')
  })

  test('creates shared knowledge bases and mounts them into a project through RPC', async () => {
    const project = projectStore.create({ name: 'AI IDE', workDir: tmp })

    const created = await callKnowledgeRpc('knowledgeBases.create', {
      type: 'knowledgeBases.create',
      projectId: project.id,
      name: 'Shared Playbook',
      kind: 'shared',
      src: 'manual',
    }) as Record<string, unknown>
    const kb = asRecord(created.kb)
    expect(kb).toMatchObject({ name: 'Shared Playbook', kind: 'shared', project_id: null })

    await callKnowledgeRpc('knowledgeBases.mount', {
      type: 'knowledgeBases.mount',
      projectId: project.id,
      kbId: kb.id,
    })

    const listed = await callKnowledgeRpc('knowledgeBases.list', {
      type: 'knowledgeBases.list',
      projectId: project.id,
    }) as Record<string, unknown>
    expect(asRecords(listed.knowledgeBases).map((item) => item.id)).toContain(kb.id)
  })
})

async function callKnowledgeRpc(type: string, msg: Record<string, unknown>): Promise<unknown> {
  let result: unknown
  await knowledgeBaseRpcHandlers[type](
    msg as never,
    {
      state: { subscriptions: new Set() },
      sendResult: (data) => {
        result = data
      },
      sendError: (message) => {
        throw new Error(message)
      },
      sendOutOfBandError: (message) => {
        throw new Error(message)
      },
    },
  )
  return result
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object')
  return value as Record<string, unknown>
}

function asRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('expected array')
  return value.map(asRecord)
}
