import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  configureProjectInspiration,
  createInspirationNote,
  createTaskFromInspirationCandidate,
  getInspirationNote,
  publishInspirationAnalysis,
  rebuildProjectInspirationSession,
} from '../../src/core/project-inspiration.js'
import { sessionManager } from '../../src/core/sessions.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { inspirationNoteStore } from '../../src/store/inspiration-notes.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { taskStepStore } from '../../src/store/task-steps.js'
import { taskStore } from '../../src/store/tasks.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import { isToolVisibleForSession } from '../../src/tools/session-tool-visibility.js'

const root = mkdtempSync(resolve(tmpdir(), 'ai-ide-project-inspiration-'))
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

describe('project inspiration service', () => {
  test('uses one visible project Session and only exposes the publish tool there', async () => {
    const fixture = createFixture()
    const config = await configureProjectInspiration(fixture.project.id, {
      organizerAgentId: fixture.organizer.id,
      organizationPrompt: '整理项目灵感',
    })
    const otherSession = sessionStore.create({ agentId: fixture.organizer.id, projectId: fixture.project.id })

    expect(config.sessionId).toBeTruthy()
    expect(sessionStore.get(config.sessionId!)?.purpose).toBe('conversation')
    expect(sessionStore.get(config.sessionId!)?.title).toBe('项目灵感会话')
    expect(isToolVisibleForSession('inspiration.analysis.publish', config.sessionId!)).toBe(true)
    expect(isToolVisibleForSession('inspiration.analysis.publish', otherSession.id)).toBe(false)
    expect(isToolVisibleForSession('studio.task.createSimple', config.sessionId!)).toBe(false)
  })

  test('requeues processing notes when the organizer Session is rebuilt', async () => {
    const fixture = createFixture()
    const first = await configureProjectInspiration(fixture.project.id, {
      organizerAgentId: fixture.organizer.id,
      autoOrganize: false,
    })
    const note = inspirationNoteStore.create({
      projectId: fixture.project.id,
      title: '切换整理器',
      sourceMarkdown: '处理中更换 Agent',
      queued: true,
    })
    inspirationNoteStore.claimNext(fixture.project.id)

    const next = await rebuildProjectInspirationSession(fixture.project.id, fixture.executor.id)

    expect(inspirationNoteStore.get(note.id)?.status).toBe('queued')
    expect(isToolVisibleForSession('inspiration.analysis.publish', first.sessionId!)).toBe(false)
    expect(isToolVisibleForSession('inspiration.analysis.publish', next.sessionId!)).toBe(true)
  })

  test('publishes a queued note through the Session-scoped tool', async () => {
    const fixture = createFixture()
    const gate = deferred<void>()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockReturnValue(gate.promise)
    const config = await configureProjectInspiration(fixture.project.id, {
      organizerAgentId: fixture.organizer.id,
    })
    const note = await createInspirationNote(fixture.project.id, {
      title: '统一预览',
      sourceMarkdown: '统一文件和原型预览入口',
    })
    await waitUntil(() => enqueue.mock.calls.length === 1)
    expect(inspirationNoteStore.get(note.id)?.status).toBe('processing')

    const handler = getHandler('inspiration.analysis.publish')
    const attemptId = inspirationNoteStore.get(note.id)?.analysis_attempt_id
    const result = await handler.execute({
      noteId: note.id,
      expectedRevision: 1,
      analysisAttemptId: attemptId,
      summary: '统一入口，保留权限边界',
      bodyMarkdown: '# 建议方案\n' + '统一交互入口并保留现有权限边界。'.repeat(10),
      questions: ['是否允许原型访问 API？'],
      candidates: [{
        title: '设计统一预览协议',
        descriptionMarkdown: '## 目标\n输出协议和权限矩阵',
        suggestedAgentId: fixture.executor.id,
        agentReason: '适合架构设计',
      }],
    }, { projectId: fixture.project.id, sessionId: config.sessionId! })
    expect(inspirationNoteStore.get(note.id)?.status).toBe('processing')
    expect(getInspirationNote(fixture.project.id, note.id)).toMatchObject({
      status: 'processing', summary: '', bodyMarkdown: '', candidates: [],
    })
    gate.resolve()
    await gate.promise
    await waitUntil(() => inspirationNoteStore.get(note.id)?.status === 'ready')

    expect(result.isError).not.toBe(true)
    expect(getInspirationNote(fixture.project.id, note.id)).toMatchObject({
      status: 'ready',
      summary: '统一入口，保留权限边界',
      candidates: [expect.objectContaining({ title: '设计统一预览协议' })],
    })
  })

  test('rejects placeholder output and an old analysis attempt', async () => {
    const fixture = createFixture()
    const gate = deferred<void>()
    vi.spyOn(sessionManager, 'enqueuePrompt').mockReturnValue(gate.promise)
    const config = await configureProjectInspiration(fixture.project.id, { organizerAgentId: fixture.organizer.id })
    const note = await createInspirationNote(fixture.project.id, {
      title: '',
      titleMode: 'auto',
      sourceMarkdown: '4、AI发展到最后是什么，假设token不要钱的话，最后的形式',
    })
    expect(note).toMatchObject({
      title: '4、AI发展到最后是什么，假设token不要钱的话，最后的形式',
      titleMode: 'auto',
    })
    await waitUntil(() => inspirationNoteStore.get(note.id)?.status === 'processing')
    const attemptId = inspirationNoteStore.get(note.id)?.analysis_attempt_id
    const handler = getHandler('inspiration.analysis.publish')

    const placeholder = await handler.execute({
      noteId: note.id,
      expectedRevision: 1,
      analysisAttemptId: attemptId,
      summary: 'test',
      bodyMarkdown: 'test',
      questions: ['question one'],
      candidates: [],
    }, { projectId: fixture.project.id, sessionId: config.sessionId! })
    expect(placeholder.isError).toBe(true)

    const stale = await handler.execute({
      noteId: note.id,
      expectedRevision: 1,
      analysisAttemptId: 'attempt-old',
      summary: '这是一份足够长的摘要',
      bodyMarkdown: '# 完整分析\n' + '这是一份足够长的完整分析内容。'.repeat(10),
      questions: [],
      candidates: [],
    }, { projectId: fixture.project.id, sessionId: config.sessionId! })
    expect(stale.isError).toBe(true)

    gate.reject(new Error('stop test turn'))
    await expect(gate.promise).rejects.toThrow('stop test turn')
  })

  test('creates a draft Task once when the user chooses only create', async () => {
    const fixture = createFixture()
    const { noteId, candidateId } = readyCandidate(fixture.project.id, fixture.executor.id)

    const first = await createTaskFromInspirationCandidate(fixture.project.id, candidateId, {
      agentId: fixture.executor.id,
      execute: false,
    })
    const second = await createTaskFromInspirationCandidate(fixture.project.id, candidateId, {
      agentId: fixture.executor.id,
      execute: false,
    })
    const taskId = first.candidates[0].taskId!

    expect(second.candidates[0].taskId).toBe(taskId)
    expect(taskStore.get(taskId)).toMatchObject({ status: 'draft', source: 'inspiration' })
    expect(taskStepStore.listByTask(taskId)).toEqual([
      expect.objectContaining({ assignee_agent_id: fixture.executor.id, status: 'pending' }),
    ])
    expect(getInspirationNote(fixture.project.id, noteId).candidates[0].taskId).toBe(taskId)
  })

  test('immediately dispatches a candidate to a new dedicated Session', async () => {
    const fixture = createFixture()
    vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    const { candidateId } = readyCandidate(fixture.project.id, fixture.executor.id)

    const note = await createTaskFromInspirationCandidate(fixture.project.id, candidateId, {
      agentId: fixture.executor.id,
      execute: true,
    })
    const candidate = note.candidates[0]

    expect(candidate.taskId).toBeTruthy()
    expect(candidate.executionSessionId).toBeTruthy()
    expect(taskStore.get(candidate.taskId!)).toMatchObject({ status: 'running', source: 'inspiration' })
    expect(sessionStore.get(candidate.executionSessionId!)?.agent_id).toBe(fixture.executor.id)
  })
})

function createFixture() {
  const project = projectStore.create({ name: 'P', workDir: root })
  const organizer = agentStore.create({
    type: 'product', name: '整理器', runtime: 'mock', projectId: project.id,
  })
  const executor = agentStore.create({
    type: 'dev', name: '执行者', runtime: 'mock', projectId: project.id,
  })
  return { project, organizer, executor }
}

function readyCandidate(projectId: string, agentId: string): { noteId: string; candidateId: string } {
  const note = inspirationNoteStore.create({
    projectId,
    title: '候选任务',
    sourceMarkdown: '原始内容',
    queued: true,
  })
  inspirationNoteStore.claimNext(projectId)
  const published = publishInspirationAnalysisForTest(projectId, note.id, agentId)
  return { noteId: note.id, candidateId: published.candidates[0].id }
}

function publishInspirationAnalysisForTest(projectId: string, noteId: string, agentId: string) {
  const attemptId = inspirationNoteStore.get(noteId)?.analysis_attempt_id
  if (!attemptId) throw new Error(`missing analysis attempt for ${projectId}`)
  const result = inspirationNoteStore.stageAnalysis(noteId, 1, attemptId, {
    summary: '这是一份完整摘要',
    bodyMarkdown: '# 方案\n' + '这是一份完整方案内容。'.repeat(20),
    questions: [],
    candidates: [{
      title: '实现候选任务',
      descriptionMarkdown: '## 目标\n完成实现',
      suggestedAgentId: agentId,
      agentReason: '适合执行',
    }],
  })
  inspirationNoteStore.finalizeAnalysis(noteId, 1, attemptId)
  if (!result.note) throw new Error(`failed to publish note for ${projectId}`)
  return getInspirationNote(projectId, result.note.id)
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function waitUntil(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5))
  }
  throw new Error('condition was not met')
}
