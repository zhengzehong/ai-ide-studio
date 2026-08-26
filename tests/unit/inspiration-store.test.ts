import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { projectInspirationStore } from '../../src/store/project-inspirations.js'
import { inspirationCandidateStore, inspirationNoteStore } from '../../src/store/inspiration-notes.js'

const root = mkdtempSync(resolve(tmpdir(), 'ai-ide-inspiration-store-'))
let index = 0

beforeEach(() => {
  closeDatabase()
  const dir = resolve(root, `case-${++index}`)
  mkdirSync(dir, { recursive: true })
  initDatabase(resolve(dir, 'test.sqlite'))
})

afterEach(() => closeDatabase())
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('project inspiration stores', () => {
  test('keeps one configuration row per project', () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const first = projectInspirationStore.ensure(project.id)
    const second = projectInspirationStore.ensure(project.id)

    expect(second.project_id).toBe(first.project_id)
    expect(projectInspirationStore.list()).toHaveLength(1)
    expect(projectInspirationStore.toData(second)).toMatchObject({
      projectId: project.id,
      sessionId: null,
      autoOrganize: true,
    })
  })

  test('rejects an old analysis revision after the note is edited', () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const note = inspirationNoteStore.create({
      projectId: project.id,
      title: '初稿',
      sourceMarkdown: '内容',
      queued: true,
    })
    const attemptId = inspirationNoteStore.claimNext(project.id)?.analysis_attempt_id
    expect(attemptId).toBeTruthy()

    const edited = inspirationNoteStore.updateSource(note.id, {
      title: '新稿',
      sourceMarkdown: '新内容',
      queue: true,
    })
    const result = inspirationNoteStore.stageAnalysis(note.id, 1, {
      summary: '旧摘要',
      bodyMarkdown: '# 旧结果',
      questions: [],
      candidates: [],
    })

    expect(edited?.analysis_revision).toBe(2)
    expect(result.staged).toBe(false)
    expect(inspirationNoteStore.get(note.id)).toMatchObject({
      status: 'queued',
      summary: '',
      analysis_revision: 2,
    })
  })

  test('keeps the latest staged analysis and finalizes it once the prompt completes', () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const note = inspirationNoteStore.create({
      projectId: project.id,
      title: '灵感',
      sourceMarkdown: '做一个功能',
      queued: true,
    })
    const processing = inspirationNoteStore.claimNext(project.id)!
    const attemptId = processing.analysis_attempt_id!
    inspirationNoteStore.stageAnalysis(note.id, 1, {
      summary: '第一版完整分析摘要',
      bodyMarkdown: '# 第一版完整方案\n' + '第一版内容'.repeat(20),
      questions: [],
      candidates: [],
    })
    const staged = inspirationNoteStore.stageAnalysis(note.id, 1, {
      summary: '第二版最终分析摘要',
      bodyMarkdown: '# 第二版最终方案\n' + '第二版内容'.repeat(20),
      questions: ['范围？'],
      candidates: [{ title: '实现功能', descriptionMarkdown: '## 目标\n完成实现' }],
    })
    expect(staged.staged).toBe(true)
    expect(inspirationNoteStore.get(note.id)).toMatchObject({ status: 'processing', summary: '' })
    expect(inspirationNoteStore.finalizeAnalysis(note.id, 1, attemptId)).toBe(true)
    expect(inspirationNoteStore.get(note.id)).toMatchObject({
      status: 'ready',
      summary: '第二版最终分析摘要',
      analysis_attempt_id: null,
    })
    const candidate = inspirationCandidateStore.listCurrent(note.id, 1)[0]
    expect(candidate).toBeDefined()
    if (!candidate) throw new Error('candidate missing')
    expect(candidate.title).toBe('实现功能')
    expect(inspirationCandidateStore.claimDispatch(candidate.id, 'token-1')?.dispatch_token).toBe('token-1')
    expect(inspirationCandidateStore.claimDispatch(candidate.id, 'token-2')).toBeUndefined()
    expect(inspirationCandidateStore.releaseStaleDispatches()).toBe(1)
    expect(inspirationCandidateStore.claimDispatch(candidate.id, 'token-3')?.dispatch_token).toBe('token-3')
    expect(inspirationCandidateStore.update(candidate.id, {
      title: '不能覆盖派发中的候选任务',
      descriptionMarkdown: '派发中的候选任务必须保持冻结',
    })).toBeUndefined()
    expect(inspirationCandidateStore.get(candidate.id)?.title).toBe('实现功能')
  })

  test('requeues processing notes after a restart', () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const note = inspirationNoteStore.create({
      projectId: project.id,
      title: '灵感',
      sourceMarkdown: '内容',
      queued: true,
    })
    const processing = inspirationNoteStore.claimNext(project.id)!
    inspirationNoteStore.stageAnalysis(note.id, 1, {
      summary: '重启前暂存摘要',
      bodyMarkdown: '# 重启前暂存方案\n' + '尚未正式提交'.repeat(20),
      questions: [],
      candidates: [],
    })

    expect(inspirationNoteStore.requeueProcessing()).toBe(1)
    expect(inspirationNoteStore.get(note.id)).toMatchObject({
      status: 'queued',
      summary: '',
      analysis_attempt_id: null,
    })
  })

  test('keeps the published result while a discussion revision is staged', () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const note = inspirationNoteStore.create({ projectId: project.id, title: '灵感', sourceMarkdown: '原文', queued: true })
    const processing = inspirationNoteStore.claimNext(project.id)!
    inspirationNoteStore.stageAnalysis(note.id, 1, {
      summary: '第一版已发布摘要',
      bodyMarkdown: '# 第一版方案\n' + '第一版内容'.repeat(20),
      questions: [],
      candidates: [],
    })
    inspirationNoteStore.finalizeAnalysis(note.id, 1, processing.analysis_attempt_id!)

    const started = inspirationNoteStore.beginDiscussion(note.id, 1)!
    expect(inspirationNoteStore.stageAnalysis(note.id, 1, {
      summary: '修订后的摘要内容',
      bodyMarkdown: '# 修订方案\n' + '修订内容'.repeat(20),
      questions: [],
      candidates: [],
    }).staged).toBe(true)
    expect(inspirationNoteStore.get(note.id)).toMatchObject({ status: 'ready', analysis_revision: 1, summary: '第一版已发布摘要' })
    expect(inspirationNoteStore.finalizeAnalysis(note.id, 1, started.analysis_attempt_id!)).toBe(true)
    expect(inspirationNoteStore.get(note.id)).toMatchObject({ analysis_revision: 2, summary: '修订后的摘要内容' })
  })
})
