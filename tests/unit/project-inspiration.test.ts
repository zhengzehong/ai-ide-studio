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
  sendInspirationDiscussion,
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
    expect(enqueue.mock.calls[0]?.[3]).toMatchObject({
      batchKey: `inspiration-organize:${note.id}:1`,
      dedupeKey: `inspiration:${note.id}:1`,
    })

    const handler = getHandler('inspiration.analysis.publish')
    const result = await handler.execute({
      noteId: note.id,
      expectedRevision: 1,
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

  test('rejects placeholder output and an old analysis revision', async () => {
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
    const handler = getHandler('inspiration.analysis.publish')

    const placeholder = await handler.execute({
      noteId: note.id,
      expectedRevision: 1,
      summary: 'test',
      bodyMarkdown: 'test',
      questions: ['question one'],
      candidates: [],
    }, { projectId: fixture.project.id, sessionId: config.sessionId! })
    expect(placeholder.isError).toBe(true)

    const stale = await handler.execute({
      noteId: note.id,
      expectedRevision: 2,
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

  test('persists project task defaults and reuses an explicitly selected Session', async () => {
    const fixture = createFixture()
    const targetSession = sessionStore.create({ agentId: fixture.executor.id, projectId: fixture.project.id })
    const configured = await configureProjectInspiration(fixture.project.id, {
      organizerAgentId: fixture.organizer.id,
      taskDefaultAgentId: fixture.executor.id,
      taskDefaultSessionId: targetSession.id,
      taskTargetPriority: 'default',
    })
    expect(configured).toMatchObject({
      taskDefaultAgentId: fixture.executor.id,
      taskDefaultSessionId: targetSession.id,
      taskTargetPriority: 'default',
    })

    vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    const { candidateId } = readyCandidate(fixture.project.id, fixture.executor.id)
    const note = await createTaskFromInspirationCandidate(fixture.project.id, candidateId, {
      execute: true,
      agentId: fixture.executor.id,
      sessionId: targetSession.id,
      sessionMode: 'existing',
    })

    expect(note.candidates[0]?.executionSessionId).toBe(targetSession.id)
    expect(taskStepStore.listByTask(note.candidates[0]!.taskId!)[0]?.session_id).toBe(targetSession.id)
  })

  test('uses the recommended Agent only when recommended priority is enabled', async () => {
    const fixture = createFixture()
    await configureProjectInspiration(fixture.project.id, {
      organizerAgentId: fixture.organizer.id,
      taskDefaultAgentId: fixture.organizer.id,
      taskTargetPriority: 'recommended',
    })
    vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    const { candidateId } = readyCandidate(fixture.project.id, fixture.executor.id)
    const note = await createTaskFromInspirationCandidate(fixture.project.id, candidateId, { execute: true })

    expect(sessionStore.get(note.candidates[0]!.executionSessionId!)?.agent_id).toBe(fixture.executor.id)
  })

  test('rejects a default Session without a matching project Agent', async () => {
    const fixture = createFixture()
    const targetSession = sessionStore.create({ agentId: fixture.executor.id, projectId: fixture.project.id })

    await expect(configureProjectInspiration(fixture.project.id, {
      organizerAgentId: fixture.organizer.id,
      taskDefaultSessionId: targetSession.id,
    })).rejects.toThrow('必须绑定默认任务 Agent')
  })

  test('validates the final default target when only the Agent changes', async () => {
    const fixture = createFixture()
    const targetSession = sessionStore.create({ agentId: fixture.executor.id, projectId: fixture.project.id })
    await configureProjectInspiration(fixture.project.id, {
      organizerAgentId: fixture.organizer.id,
      taskDefaultAgentId: fixture.executor.id,
      taskDefaultSessionId: targetSession.id,
    })

    await expect(configureProjectInspiration(fixture.project.id, {
      organizerAgentId: fixture.organizer.id,
      taskDefaultAgentId: fixture.organizer.id,
    })).rejects.toThrow('不属于默认任务 Agent')
  })

  test('does not clear the default Agent while retaining its Session', async () => {
    const fixture = createFixture()
    const targetSession = sessionStore.create({ agentId: fixture.executor.id, projectId: fixture.project.id })
    await configureProjectInspiration(fixture.project.id, {
      organizerAgentId: fixture.organizer.id,
      taskDefaultAgentId: fixture.executor.id,
      taskDefaultSessionId: targetSession.id,
    })

    await expect(configureProjectInspiration(fixture.project.id, {
      organizerAgentId: fixture.organizer.id,
      taskDefaultAgentId: null,
    })).rejects.toThrow('必须绑定默认任务 Agent')
  })

  test('falls back to the recommended Agent when default priority has no configured Agent', async () => {
    const fixture = createFixture()
    await configureProjectInspiration(fixture.project.id, {
      organizerAgentId: fixture.organizer.id,
      taskTargetPriority: 'default',
    })
    const { candidateId } = readyCandidate(fixture.project.id, fixture.executor.id)
    const note = await createTaskFromInspirationCandidate(fixture.project.id, candidateId, { execute: false })

    expect(taskStepStore.listByTask(note.candidates[0]!.taskId!)[0]?.assignee_agent_id).toBe(fixture.executor.id)
  })

  test('requires a Session when existing Session mode is selected', async () => {
    const fixture = createFixture()
    const { candidateId } = readyCandidate(fixture.project.id, fixture.executor.id)

    await expect(createTaskFromInspirationCandidate(fixture.project.id, candidateId, {
      agentId: fixture.executor.id,
      sessionMode: 'existing',
      execute: false,
    })).rejects.toThrow('必须选择执行会话')
  })

  test('binds a discussion to one note and commits a publish revision without exposing attemptId', async () => {
    const fixture = createFixture()
    const config = await configureProjectInspiration(fixture.project.id, { organizerAgentId: fixture.organizer.id })
    const note = inspirationNoteStore.create({ projectId: fixture.project.id, title: '第一篇', sourceMarkdown: '第一篇原文', queued: false })
    inspirationNoteStore.queue(note.id)
    const initial = inspirationNoteStore.claimNext(fixture.project.id)!
    inspirationNoteStore.stageAnalysis(note.id, 1, {
      summary: '原始方案摘要内容', bodyMarkdown: '# 原始方案\n' + '原始内容'.repeat(20), questions: [], candidates: [],
    })
    inspirationNoteStore.finalizeAnalysis(note.id, 1, initial.analysis_attempt_id!)
    const send = vi.spyOn(sessionManager, 'sendPrompt').mockImplementation(async (_sessionId, content, _images, options) => {
      expect(content).toBe('拆成两个候选任务')
      expect((options as Record<string, unknown>).modelContent).toContain(note.id)
      const published = await getHandler('inspiration.analysis.publish')!.execute({
        noteId: note.id,
        expectedRevision: 1,
        summary: '修订后的方案摘要内容',
        bodyMarkdown: '# 修订方案\n' + '修订后的完整内容'.repeat(20),
        questions: [], candidates: [],
      }, { projectId: fixture.project.id, sessionId: config.sessionId! })
      expect(published.isError).not.toBe(true)
    })

    await sendInspirationDiscussion({
      sessionId: config.sessionId!, noteId: note.id, content: '拆成两个候选任务', clientMessageId: 'msg-discuss-1',
    })
    send.mockRestore()
    expect(getInspirationNote(fixture.project.id, note.id)).toMatchObject({ analysisRevision: 2, summary: '修订后的方案摘要内容' })
  })

  test('keeps the published result when a discussion answers without publishing', async () => {
    const fixture = createFixture()
    const config = await configureProjectInspiration(fixture.project.id, { organizerAgentId: fixture.organizer.id })
    const { noteId } = readyCandidate(fixture.project.id, fixture.executor.id)
    const before = getInspirationNote(fixture.project.id, noteId)
    vi.spyOn(sessionManager, 'sendPrompt').mockResolvedValue(undefined)

    await sendInspirationDiscussion({
      sessionId: config.sessionId!, noteId, content: '解释一下风险，不修改方案', clientMessageId: 'msg-discuss-answer',
    })

    expect(getInspirationNote(fixture.project.id, noteId)).toMatchObject({
      analysisRevision: before.analysisRevision,
      summary: before.summary,
      bodyMarkdown: before.bodyMarkdown,
    })
    expect(inspirationNoteStore.get(noteId)).toMatchObject({ analysis_attempt_id: null, analysis_draft_json: null })
  })

  test('reads a note only from its configured inspiration Session', async () => {
    const fixture = createFixture()
    const config = await configureProjectInspiration(fixture.project.id, { organizerAgentId: fixture.organizer.id })
    const note = inspirationNoteStore.create({ projectId: fixture.project.id, title: '指定灵感', sourceMarkdown: '原始内容', queued: false })
    const handler = getHandler('inspiration.note.get')!

    const result = await handler.execute({ noteId: note.id }, { projectId: fixture.project.id, sessionId: config.sessionId! })
    expect(result.isError).not.toBe(true)
    expect(result.content[0]?.text).toContain('指定灵感')

    const ordinarySession = sessionStore.create({ agentId: fixture.organizer.id, projectId: fixture.project.id })
    const rejected = await handler.execute({ noteId: note.id }, { projectId: fixture.project.id, sessionId: ordinarySession.id })
    expect(rejected.isError).toBe(true)
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
  const result = inspirationNoteStore.stageAnalysis(noteId, 1, {
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
