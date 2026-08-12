import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { knowledgeBaseService } from '../../src/core/knowledge-base.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import type { ToolContext, ToolHandlerResult } from '../../src/tools/types.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-kb-tools-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('knowledge base MCP tool handlers', () => {
  test('exposes only the four minimal page tools', () => {
    for (const name of ['core.kb.list', 'core.kb.read', 'core.kb.upsert', 'core.kb.delete']) {
      expect(getHandler(name), `expected handler ${name}`).toBeTruthy()
    }
    for (const name of [
      'core.kb.read_index',
      'core.kb.read_page',
      'core.kb.search',
      'core.kb.create_page',
      'core.kb.update_page',
      'core.kb.refresh_from_code',
      'core.kb.create_kb',
      'core.kb.mount',
      'core.kb.unmount',
      'core.kb.revert',
    ]) {
      expect(getHandler(name), `expected legacy handler ${name} to be hidden`).toBeUndefined()
    }
  })

  test('lists lightweight pages, then creates, reads, partially updates, and deletes a page', async () => {
    const { projectId, agentId, kbId } = createProjectAgentAndKb('AI IDE')

    const listed = await executeJson('core.kb.list', {}, { projectId, agentId })
    const listedKb = asRecords(listed.knowledgeBases)[0]!
    const listedPages = asRecords(listedKb.pages)
    expect(listedPages).toHaveLength(1)
    expect(listedPages.every((page) => !('body' in page))).toBe(true)

    const created = await executeJson('core.kb.upsert', {
      kbId,
      title: 'Runtime Notes',
      section: 'Runtime',
      summary: 'Runtime summary',
      body: 'Initial body',
      tags: ['runtime'],
    }, { projectId, agentId })
    const page = asRecord(created.page)
    expect(page).toMatchObject({ title: 'Runtime Notes', body: 'Initial body', by: agentId })

    const read = await executeJson('core.kb.read', { pageId: page.id }, { projectId, agentId })
    expect(asRecord(read.page)).toMatchObject({ id: page.id, body: 'Initial body' })

    const updated = await executeJson('core.kb.upsert', {
      pageId: page.id,
      body: 'Updated body',
    }, { projectId, agentId })
    expect(asRecord(updated.page)).toMatchObject({
      id: page.id,
      title: 'Runtime Notes',
      section: 'Runtime',
      summary: 'Runtime summary',
      body: 'Updated body',
      tags_json: JSON.stringify(['runtime']),
    })

    const deleted = await executeJson('core.kb.delete', { pageId: page.id }, { projectId, agentId })
    expect(deleted).toMatchObject({ deleted: true, pageId: page.id })
    expect(asRecord(deleted.activity)).toMatchObject({ act: 'delete', tool: 'core.kb.delete', actor: agentId })
    await expect(executeJson('core.kb.read', { pageId: page.id }, { projectId, agentId }))
      .rejects.toThrow('PAGE_NOT_FOUND')
  })

  test('requires project identity from tool context instead of accepting it from input', async () => {
    const project = projectStore.create({ name: 'AI IDE', workDir: tmp })
    await expect(executeJson('core.kb.list', { projectId: project.id }, {}))
      .rejects.toThrow('projectId is required in tool context')
  })

  test('rejects cross-project writes and deleting an index page', async () => {
    const projectA = createProjectAgentAndKb('Project A')
    const projectB = createProjectAgentAndKb('Project B')

    await expect(executeJson('core.kb.upsert', {
      kbId: projectB.kbId,
      title: 'Wrong project',
      body: 'Should not be written.',
    }, { projectId: projectB.projectId, agentId: projectA.agentId }))
      .rejects.toThrow('Project mismatch')

    const index = knowledgeBaseService.readIndex(projectA.projectId, projectA.kbId).page
    await expect(executeJson('core.kb.delete', { pageId: index.id }, {
      projectId: projectA.projectId,
      agentId: projectA.agentId,
    })).rejects.toThrow('INDEX_PAGE_DELETE_FORBIDDEN')
  })
})

function createProjectAgentAndKb(name: string): { projectId: string; agentId: string; kbId: string } {
  const project = projectStore.create({ name, workDir: resolve(tmp, name) })
  const agent = agentStore.create({ name: `${name} Agent`, type: 'dev', runtime: 'mock', projectId: project.id })
  const kb = knowledgeBaseService.ensureProjectKnowledgeBase(project.id)
  return { projectId: project.id, agentId: agent.id, kbId: kb.id }
}

async function executeJson(
  handlerName: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const handler = getHandler(handlerName)
  if (!handler) throw new Error(`handler missing: ${handlerName}`)
  const result: ToolHandlerResult = await handler.execute(input, context)
  expect(result.isError).not.toBe(true)
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object')
  return value as Record<string, unknown>
}

function asRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('expected array')
  return value.map(asRecord)
}
