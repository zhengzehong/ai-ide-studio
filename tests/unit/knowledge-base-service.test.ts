import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { knowledgeBaseService } from '../../src/core/knowledge-base.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-kb-'))
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('knowledge base service', () => {
  test('creates one project knowledge base and returns mounted shared libraries as visible knowledge', () => {
    const project = projectStore.create({ name: 'AI IDE', workDir: tmp })

    const projectKb = knowledgeBaseService.ensureProjectKnowledgeBase(project.id)
    const secondEnsure = knowledgeBaseService.ensureProjectKnowledgeBase(project.id)
    expect(secondEnsure.id).toBe(projectKb.id)
    expect(projectKb).toMatchObject({ kind: 'project', src: 'manual', project_id: project.id })

    const shared = knowledgeBaseService.createKnowledgeBase({
      name: '前端规范库',
      kind: 'shared',
      src: 'manual',
      actor: 'human',
      tool: 'manual',
    })
    const mount = knowledgeBaseService.mountKnowledgeBase({ projectId: project.id, kbId: shared.id, actor: 'human', tool: 'manual' })

    expect(mount.kb_id).toBe(shared.id)
    expect(knowledgeBaseService.listVisibleKnowledgeBases(project.id).map((kb) => kb.id).sort()).toEqual([projectKb.id, shared.id].sort())
  })

  test('reads pages with wikilink outlinks and backlinks across visible libraries', () => {
    const project = projectStore.create({ name: 'AI IDE', workDir: tmp })
    const projectKb = knowledgeBaseService.ensureProjectKnowledgeBase(project.id)
    const shared = knowledgeBaseService.createKnowledgeBase({ name: 'ACP 经验库', kind: 'shared', src: 'manual', actor: 'agent-a', tool: 'core.kb.create_kb' })
    knowledgeBaseService.mountKnowledgeBase({ projectId: project.id, kbId: shared.id, actor: 'human', tool: 'manual' })
    const sessionPage = knowledgeBaseService.createPage({
      projectId: project.id,
      kbId: projectKb.id,
      title: 'Session执行原语',
      body: 'Session 是唯一执行原语。',
      actor: 'agent-a',
      actorType: 'ai',
      tool: 'core.kb.create_page',
    }).page
    const indexPage = knowledgeBaseService.updatePage({
      projectId: project.id,
      pageId: projectKb.index_page_id!,
      body: `入口链接 [[Session执行原语]] 和 [[ACP 经验库/会话恢复]]。`,
      actor: 'agent-a',
      actorType: 'ai',
      tool: 'core.kb.update_page',
    }).page
    const sharedPage = knowledgeBaseService.createPage({
      projectId: project.id,
      kbId: shared.id,
      title: '会话恢复',
      body: '恢复时先看 [[Session执行原语]]。',
      actor: 'agent-a',
      actorType: 'ai',
      tool: 'core.kb.create_page',
    }).page

    const readIndex = knowledgeBaseService.readPage({ projectId: project.id, pageId: indexPage.id })
    expect(readIndex.outLinks.map((link) => link.pageId).sort()).toEqual([sessionPage.id, sharedPage.id].sort())

    const readSession = knowledgeBaseService.readPage({ projectId: project.id, pageId: sessionPage.id })
    expect(readSession.backlinks.map((link) => link.pageId).sort()).toEqual([indexPage.id, sharedPage.id].sort())
  })

  test('read_index exposes page structure for index-first navigation', () => {
    const project = projectStore.create({ name: 'AI IDE', workDir: tmp })
    const projectKb = knowledgeBaseService.ensureProjectKnowledgeBase(project.id)
    const created = knowledgeBaseService.createPage({
      projectId: project.id,
      kbId: projectKb.id,
      title: 'Workspace State',
      section: 'Runtime',
      summary: 'Workspace session state rules',
      body: 'Workspace state details.',
      actor: 'agent-a',
      actorType: 'ai',
      tool: 'core.kb.create_page',
    }).page

    const index = knowledgeBaseService.readIndex(project.id, projectKb.id)
    expect(index.page.body).toContain('## 页面索引')
    expect(index.page.body).toContain('### Runtime')
    expect(index.page.body).toContain('- [[Workspace State]] - Workspace session state rules')
    expect(index.outLinks.map((link) => link.pageId)).toContain(created.id)

    const readCreated = knowledgeBaseService.readPage({ projectId: project.id, pageId: created.id })
    expect(readCreated.backlinks.map((link) => link.pageId)).toContain(index.page.id)
  })

  test('records activity for writes and reverts page edits', () => {
    const project = projectStore.create({ name: 'AI IDE', workDir: tmp })
    const projectKb = knowledgeBaseService.ensureProjectKnowledgeBase(project.id)
    const created = knowledgeBaseService.createPage({
      projectId: project.id,
      kbId: projectKb.id,
      title: '任务状态机',
      body: '旧内容',
      actor: 'agent-a',
      actorType: 'ai',
      tool: 'core.kb.create_page',
      note: 'first draft',
    })
    const edited = knowledgeBaseService.updatePage({
      projectId: project.id,
      pageId: created.page.id,
      body: '新内容',
      actor: 'agent-a',
      actorType: 'ai',
      tool: 'core.kb.update_page',
      note: 'rewrite',
    })

    expect(knowledgeBaseService.listActivities(project.id, projectKb.id).map((activity) => activity.act)).toContain('edit')
    const reverted = knowledgeBaseService.revertActivity({ projectId: project.id, activityId: edited.activity.id, actor: 'human', tool: 'manual' })

    expect(reverted.page?.body).toBe('旧内容')
    expect(knowledgeBaseService.listActivities(project.id, projectKb.id)[0].act).toBe('revert')
  })

  test('marks code pages stale when source fingerprints change and refresh clears stale with human edit confirmation', () => {
    const project = projectStore.create({ name: 'AI IDE', workDir: tmp })
    const sourcePath = resolve(tmp, 'src/core/tasks.ts')
    mkdirSync(resolve(tmp, 'src/core'), { recursive: true })
    writeFileSync(sourcePath, 'export const version = 1\n')
    const kb = knowledgeBaseService.createKnowledgeBase({
      name: '代码库',
      kind: 'shared',
      src: 'code',
      actor: 'human',
      tool: 'manual',
    })
    knowledgeBaseService.mountKnowledgeBase({ projectId: project.id, kbId: kb.id, actor: 'human', tool: 'manual' })
    const page = knowledgeBaseService.createPage({
      projectId: project.id,
      kbId: kb.id,
      title: '任务模块',
      body: '代码说明',
      srcFiles: [sourcePath],
      actor: 'agent-a',
      actorType: 'ai',
      tool: 'core.kb.create_page',
    }).page

    writeFileSync(sourcePath, 'export const version = 2\n')
    expect(knowledgeBaseService.readPage({ projectId: project.id, pageId: page.id }).page.stale).toBe(1)

    knowledgeBaseService.updatePage({
      projectId: project.id,
      pageId: page.id,
      body: '人工说明',
      actor: 'human',
      actorType: 'human',
      tool: 'manual',
    })
    expect(() => knowledgeBaseService.refreshFromCode({
      projectId: project.id,
      pageId: page.id,
      body: 'AI 刷新说明',
      actor: 'agent-a',
      actorType: 'ai',
      tool: 'core.kb.refresh_from_code',
    })).toThrow(/HUMAN_EDIT_CONFIRM_REQUIRED/)

    const refreshed = knowledgeBaseService.refreshFromCode({
      projectId: project.id,
      pageId: page.id,
      body: 'AI 刷新说明',
      actor: 'agent-a',
      actorType: 'ai',
      tool: 'core.kb.refresh_from_code',
      confirmOverwriteHumanEdit: true,
    })
    expect(refreshed.page.stale).toBe(0)
    expect(refreshed.page.body).toBe('AI 刷新说明')

    writeFileSync(sourcePath, 'export const version = 3\n')
    expect(knowledgeBaseService.readPage({ projectId: project.id, pageId: page.id }).page.stale).toBe(1)
    expect(() => knowledgeBaseService.refreshFromCode({
      projectId: project.id,
      pageId: page.id,
      body: 'AI 二次刷新说明',
      actor: 'agent-a',
      actorType: 'ai',
      tool: 'core.kb.refresh_from_code',
    })).not.toThrow()
  })

  test('resolves code source fingerprints from the project work directory', () => {
    const project = projectStore.create({ name: 'AI IDE', workDir: tmp })
    const sourcePath = resolve(tmp, 'src/core/relative-source.ts')
    mkdirSync(resolve(tmp, 'src/core'), { recursive: true })
    writeFileSync(sourcePath, 'export const version = 1\n')
    const kb = knowledgeBaseService.createKnowledgeBase({
      name: 'Relative Code Wiki',
      kind: 'shared',
      src: 'code',
      actor: 'human',
      tool: 'manual',
    })
    knowledgeBaseService.mountKnowledgeBase({ projectId: project.id, kbId: kb.id, actor: 'human', tool: 'manual' })

    const page = knowledgeBaseService.createPage({
      projectId: project.id,
      kbId: kb.id,
      title: 'Relative Source Page',
      body: 'Source files are relative to the project work directory.',
      srcFiles: ['src/core/relative-source.ts'],
      actor: 'agent-a',
      actorType: 'ai',
      tool: 'core.kb.create_page',
    }).page

    expect(page.src_files_json).toBe('["src/core/relative-source.ts"]')

    writeFileSync(sourcePath, 'export const version = 2\n')
    expect(knowledgeBaseService.readPage({ projectId: project.id, pageId: page.id }).page.stale).toBe(1)
  })

  test('ignores source files on manual knowledge pages', () => {
    const project = projectStore.create({ name: 'AI IDE', workDir: tmp })
    const sourcePath = resolve(tmp, 'src/manual-note.ts')
    mkdirSync(resolve(tmp, 'src'), { recursive: true })
    writeFileSync(sourcePath, 'export const version = 1\n')
    const projectKb = knowledgeBaseService.ensureProjectKnowledgeBase(project.id)

    const page = knowledgeBaseService.createPage({
      projectId: project.id,
      kbId: projectKb.id,
      title: 'Manual Note',
      body: 'Manual knowledge should not follow source files.',
      srcFiles: [sourcePath],
      actor: 'agent-a',
      actorType: 'ai',
      tool: 'core.kb.create_page',
    }).page

    writeFileSync(sourcePath, 'export const version = 2\n')
    const read = knowledgeBaseService.readPage({ projectId: project.id, pageId: page.id })

    expect(read.page.src_files_json).toBe('[]')
    expect(read.page.stale).toBe(0)
  })
})
