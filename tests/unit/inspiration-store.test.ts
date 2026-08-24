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
    expect(inspirationNoteStore.claimNext(project.id)?.analysis_revision).toBe(1)

    const edited = inspirationNoteStore.updateSource(note.id, {
      title: '新稿',
      sourceMarkdown: '新内容',
      queue: true,
    })
    const result = inspirationNoteStore.publishAnalysis(note.id, 1, {
      summary: '旧摘要',
      bodyMarkdown: '# 旧结果',
      questions: [],
      candidates: [],
    })

    expect(edited?.analysis_revision).toBe(2)
    expect(result.applied).toBe(false)
    expect(inspirationNoteStore.get(note.id)).toMatchObject({
      status: 'queued',
      summary: '',
      analysis_revision: 2,
    })
  })

  test('publishes current candidates and keeps task dispatch idempotent', () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const note = inspirationNoteStore.create({
      projectId: project.id,
      title: '灵感',
      sourceMarkdown: '做一个功能',
      queued: true,
    })
    inspirationNoteStore.claimNext(project.id)
    const published = inspirationNoteStore.publishAnalysis(note.id, 1, {
      summary: '摘要',
      bodyMarkdown: '# 方案',
      questions: ['范围？'],
      candidates: [{ title: '实现功能', descriptionMarkdown: '## 目标\n完成实现' }],
    })
    const candidate = published.candidates[0]

    expect(published.applied).toBe(true)
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
    inspirationNoteStore.claimNext(project.id)

    expect(inspirationNoteStore.requeueProcessing()).toBe(1)
    expect(inspirationNoteStore.get(note.id)?.status).toBe('queued')
  })
})
