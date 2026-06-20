import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  test('lists visible knowledge bases and reads index-first content', async () => {
    const project = projectStore.create({ name: 'AI IDE', workDir: tmp })
    const shared = knowledgeBaseService.createKnowledgeBase({
      name: 'Team Playbook',
      kind: 'shared',
      src: 'manual',
      actor: 'human',
      actorType: 'human',
      tool: 'manual',
    })
    knowledgeBaseService.mountKnowledgeBase({ projectId: project.id, kbId: shared.id, actor: 'human', tool: 'manual' })

    const listed = await executeJson('core.kb.list', {}, { projectId: project.id, agentId: 'agent-a' })
    expect(asRecords(listed.knowledgeBases).map((kb) => kb.id).sort()).toEqual(
      [knowledgeBaseService.ensureProjectKnowledgeBase(project.id).id, shared.id].sort(),
    )

    const index = await executeJson('core.kb.read_index', { kbId: shared.id }, { projectId: project.id, agentId: 'agent-a' })
    expect(asRecord(index.kb)).toMatchObject({ id: shared.id })
    expect(asRecord(index.page)).toMatchObject({ id: shared.index_page_id, is_index: 1 })
  })

  test('creates, searches, reads, updates, and reverts pages with activity', async () => {
    const project = projectStore.create({ name: 'AI IDE', workDir: tmp })
    const agent = agentStore.create({ name: 'Agent A', type: 'dev', runtime: 'mock', projectId: project.id })
    const projectKb = knowledgeBaseService.ensureProjectKnowledgeBase(project.id)

    const created = await executeJson(
      'core.kb.create_page',
      {
        kbId: projectKb.id,
        title: 'Session Lifecycle',
        section: 'Runtime',
        summary: 'How sessions move through states',
        body: 'Use [[Project Index]] before changing session state.',
        tags: ['session'],
      },
      { projectId: project.id, agentId: agent.id },
    )
    const page = asRecord(created.page)
    expect(page).toMatchObject({ title: 'Session Lifecycle', by: agent.id })
    expect(Array.isArray(created.warnings)).toBe(true)

    const searched = await executeJson(
      'core.kb.search',
      { query: 'Lifecycle', kbIds: [projectKb.id] },
      { projectId: project.id, agentId: agent.id },
    )
    expect(asRecords(searched.pages).map((item) => item.id)).toContain(page.id)

    const read = await executeJson(
      'core.kb.read_page',
      { pageId: page.id },
      { projectId: project.id, agentId: agent.id },
    )
    expect(asRecord(read.page).body).toContain('Project Index')
    expect(asRecords(read.outLinks)[0]).toMatchObject({ title: 'Project Index', status: 'missing' })

    const updated = await executeJson(
      'core.kb.update_page',
      { pageId: page.id, body: 'Final session state rules.' },
      { projectId: project.id, agentId: agent.id },
    )
    expect(asRecord(updated.page).body).toBe('Final session state rules.')
    expect(asRecord(updated.activity)).toMatchObject({ act: 'edit', tool: 'core.kb.update_page' })

    const reverted = await executeJson(
      'core.kb.revert',
      { activityId: asRecord(updated.activity).id },
      { projectId: project.id, agentId: agent.id },
    )
    expect(asRecord(reverted.page).body).toContain('Project Index')
  })

  test('rejects cross-project knowledge writes from an agent outside the target project', async () => {
    const projectA = projectStore.create({ name: 'Project A', workDir: resolve(tmp, 'project-a') })
    const projectB = projectStore.create({ name: 'Project B', workDir: resolve(tmp, 'project-b') })
    const projectC = projectStore.create({ name: 'Project C', workDir: resolve(tmp, 'project-c') })
    const agentA = agentStore.create({ name: 'Agent A', type: 'dev', runtime: 'mock', projectId: projectA.id })
    const agentB = agentStore.create({ name: 'Agent B', type: 'dev', runtime: 'mock', projectId: projectB.id })
    const projectBKb = knowledgeBaseService.ensureProjectKnowledgeBase(projectB.id)
    const createdPage = knowledgeBaseService.createPage({
      projectId: projectB.id,
      kbId: projectBKb.id,
      title: 'Owned By Project B',
      body: 'Project B content.',
      actor: agentB.id,
      actorType: 'ai',
      tool: 'setup',
    })
    const codeKb = knowledgeBaseService.createKnowledgeBase({
      name: 'Project B Code Wiki',
      kind: 'shared',
      src: 'code',
      actor: agentB.id,
      actorType: 'ai',
      tool: 'setup',
    })
    knowledgeBaseService.mountKnowledgeBase({ projectId: projectB.id, kbId: codeKb.id, actor: agentB.id, tool: 'setup' })
    const sourcePath = resolve(tmp, 'project-b/src/core/session.ts')
    mkdirSync(resolve(tmp, 'project-b/src/core'), { recursive: true })
    writeFileSync(sourcePath, 'export const version = 1\n')
    const codePage = knowledgeBaseService.createPage({
      projectId: projectB.id,
      kbId: codeKb.id,
      title: 'Code Page',
      body: 'Version one.',
      srcFiles: [sourcePath],
      actor: agentB.id,
      actorType: 'ai',
      tool: 'setup',
    })
    const mountedKb = knowledgeBaseService.createKnowledgeBase({
      name: 'Already Mounted',
      kind: 'shared',
      src: 'manual',
      actor: agentB.id,
      actorType: 'ai',
      tool: 'setup',
    })
    knowledgeBaseService.mountKnowledgeBase({ projectId: projectB.id, kbId: mountedKb.id, actor: agentB.id, tool: 'setup' })
    const unmountedKb = knowledgeBaseService.createKnowledgeBase({
      name: 'Unmounted',
      kind: 'shared',
      src: 'manual',
      actor: agentB.id,
      actorType: 'ai',
      tool: 'setup',
    })

    const attempts: Array<{ handler: string; input: Record<string, unknown>; projectId: string }> = [
      {
        handler: 'core.kb.create_page',
        input: { kbId: projectBKb.id, title: 'Cross Project Write', body: 'This write should be rejected.' },
        projectId: projectB.id,
      },
      {
        handler: 'core.kb.update_page',
        input: { pageId: createdPage.page.id, body: 'Cross project update.' },
        projectId: projectB.id,
      },
      {
        handler: 'core.kb.refresh_from_code',
        input: { pageId: codePage.page.id, body: 'Cross project refresh.' },
        projectId: projectB.id,
      },
      {
        handler: 'core.kb.create_kb',
        input: { name: 'Cross Project Shared KB', kind: 'shared', src: 'manual' },
        projectId: projectB.id,
      },
      {
        handler: 'core.kb.create_kb',
        input: { name: 'Cross Project Project KB', kind: 'project', src: 'manual' },
        projectId: projectC.id,
      },
      {
        handler: 'core.kb.mount',
        input: { kbId: unmountedKb.id },
        projectId: projectB.id,
      },
      {
        handler: 'core.kb.unmount',
        input: { kbId: mountedKb.id },
        projectId: projectB.id,
      },
      {
        handler: 'core.kb.revert',
        input: { activityId: createdPage.activity.id },
        projectId: projectB.id,
      },
    ]

    for (const attempt of attempts) {
      await expect(
        executeJson(attempt.handler, attempt.input, { projectId: attempt.projectId, agentId: agentA.id }),
      ).rejects.toThrow('Project mismatch')
    }
  })

  test('creates shared code knowledge bases, mounts them, refreshes code pages, and unmounts them', async () => {
    const project = projectStore.create({ name: 'AI IDE', workDir: tmp })
    const agent = agentStore.create({ name: 'Agent A', type: 'dev', runtime: 'mock', projectId: project.id })
    const sourcePath = resolve(tmp, 'src/core/session.ts')
    mkdirSync(resolve(tmp, 'src/core'), { recursive: true })
    writeFileSync(sourcePath, 'export const version = 1\n')

    const createdKb = await executeJson(
      'core.kb.create_kb',
      { name: 'Code Wiki', kind: 'shared', src: 'code' },
      { projectId: project.id, agentId: agent.id },
    )
    const kb = asRecord(createdKb.kb)
    const mounted = await executeJson('core.kb.mount', { kbId: kb.id }, { projectId: project.id, agentId: agent.id })
    expect(asRecord(mounted.mount)).toMatchObject({ kb_id: kb.id, project_id: project.id })

    const createdPage = await executeJson(
      'core.kb.create_page',
      {
        kbId: kb.id,
        title: 'Session Module',
        body: 'Version one notes.',
        srcFiles: [sourcePath],
      },
      { projectId: project.id, agentId: agent.id },
    )
    const page = asRecord(createdPage.page)
    writeFileSync(sourcePath, 'export const version = 2\n')
    const staleRead = await executeJson(
      'core.kb.read_page',
      { pageId: page.id },
      { projectId: project.id, agentId: agent.id },
    )
    expect(asRecord(staleRead.page).stale).toBe(1)

    const refreshed = await executeJson(
      'core.kb.refresh_from_code',
      { pageId: page.id, body: 'Version two notes.' },
      { projectId: project.id, agentId: agent.id },
    )
    expect(asRecord(refreshed.page)).toMatchObject({ stale: 0, body: 'Version two notes.' })
    expect(asRecord(refreshed.activity)).toMatchObject({ act: 'refresh', tool: 'core.kb.refresh_from_code' })

    const unmounted = await executeJson('core.kb.unmount', { kbId: kb.id }, { projectId: project.id, agentId: agent.id })
    expect(unmounted.ok).toBe(true)
  })
})

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
