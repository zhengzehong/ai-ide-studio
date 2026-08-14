import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createProjectSecretary, updateProjectSecretary } from '../../src/core/project-secretary.js'
import { events } from '../../src/core/events.js'
import { sessionManager } from '../../src/core/sessions.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { projectSecretaryStore } from '../../src/store/project-secretaries.js'
import { secretaryMailStore } from '../../src/store/secretary-mail.js'
import { secretaryRunStore } from '../../src/store/secretary-runs.js'
import { sessionStore } from '../../src/store/sessions.js'
import { getHandler } from '../../src/tools/handlers/index.js'

const root = mkdtempSync(resolve(tmpdir(), 'ai-ide-secretary-'))
let index = 0

beforeEach(() => {
  closeDatabase()
  const dir = resolve(root, `case-${++index}`)
  mkdirSync(resolve(dir, 'docs'), { recursive: true })
  writeFileSync(resolve(dir, 'docs', 'report.md'), '# Report\n', 'utf8')
  initDatabase(resolve(dir, 'test.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  closeDatabase()
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('project secretary MVP', () => {
  test('creates hidden runtime and chat Sessions without changing normal Session lists', async () => {
    const fixture = createFixture()
    const secretary = await createProjectSecretary({
      projectId: fixture.project.id,
      name: '研发秘书',
      definitionPrompt: '跟踪研发进展',
      reportPrompt: '只汇报重要变化',
      executionAgentId: fixture.execution.id,
      observedAgentIds: [fixture.observed.id],
    })

    expect(secretary.runtimeSessionId).not.toBeNull()
    expect(secretary.chatSessionId).not.toBeNull()
    expect(sessionStore.get(secretary.runtimeSessionId!)?.purpose).toBe('secretary_runtime')
    expect(sessionStore.get(secretary.chatSessionId!)?.purpose).toBe('secretary_chat')
    expect(sessionStore.list(undefined, fixture.project.id)).toEqual([
      expect.objectContaining({ id: fixture.observedSession.id, purpose: 'conversation' }),
    ])
    expect(secretary.triggers.some((trigger) => trigger.type === 'session_done')).toBe(true)
  })

  test('stores a report thread and validates project-relative attachments', async () => {
    const fixture = createFixture()
    const secretary = await createProjectSecretary({
      projectId: fixture.project.id,
      name: '交付秘书',
      definitionPrompt: '',
      reportPrompt: '',
      executionAgentId: fixture.execution.id,
      observedAgentIds: [],
      observeAll: true,
    })
    const handler = getHandler('secretary.report')
    expect(handler).toBeDefined()
    if (!handler) return
    const result = await handler.execute({
      threadKey: 'build',
      subject: '构建结果',
      summary: '构建已完成',
      markdown: '## 结果\n\n通过',
      needsAction: false,
      attachments: [{ path: 'docs/report.md', title: '报告' }],
    }, {
      projectId: fixture.project.id,
      agentId: fixture.execution.id,
      sessionId: secretary.runtimeSessionId!,
      workDir: fixture.project.work_dir,
    })
    const output = JSON.parse(result.content[0].text) as { threadId: string }
    expect(secretaryMailStore.get(output.threadId)).toMatchObject({
      subject: '构建结果',
      summary: '构建已完成',
      attachments: [{ path: 'docs/report.md', title: '报告', kind: 'text' }],
    })
    expect(projectSecretaryStore.getData(secretary.id)?.unreadCount).toBe(1)
    secretaryMailStore.markRead(output.threadId)
    expect(projectSecretaryStore.getData(secretary.id)?.unreadCount).toBe(0)
    await expect(handler.execute({ subject: '危险', markdown: 'x', attachments: [{ path: '../outside.md' }] }, {
      projectId: fixture.project.id,
      agentId: fixture.execution.id,
      sessionId: secretary.runtimeSessionId!,
      workDir: fixture.project.work_dir,
    })).rejects.toThrow('非隐藏相对路径')
    await expect(handler.execute({ subject: '绝对路径', markdown: 'x', attachments: [{ path: resolve(fixture.project.work_dir, 'docs/report.md') }] }, {
      projectId: fixture.project.id,
      agentId: fixture.execution.id,
      sessionId: secretary.runtimeSessionId!,
      workDir: fixture.project.work_dir,
    })).rejects.toThrow('非隐藏相对路径')
  })

  test('queues only observed project Session completion events', async () => {
    const first = createFixture()
    const secondProject = projectStore.create({ name: 'Other', workDir: first.project.work_dir })
    const secondAgent = agentStore.create({ name: 'Other Agent', type: 'dev', runtime: 'mock', projectId: secondProject.id })
    const secretary = await createProjectSecretary({
      projectId: first.project.id,
      name: '观察秘书',
      definitionPrompt: '',
      reportPrompt: '',
      executionAgentId: first.execution.id,
      observedAgentIds: [first.observed.id],
    })
    vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    events.emit('session:committed_done', { sessionId: first.observedSession.id, agentId: first.observed.id, messageId: 'msg-observed', stopReason: 'end_turn' })
    events.emit('session:committed_done', { sessionId: secondAgent.id, agentId: secondAgent.id, messageId: 'msg-other', stopReason: 'end_turn' })
    await new Promise((resolveWait) => setImmediate(resolveWait))
    expect(secretaryRunStore.list(secretary.id)).toHaveLength(1)
    expect(secretaryRunStore.list(secretary.id)[0]?.source_id).toBe('msg-observed')
    expect(projectSecretaryStore.get(secretary.id)?.project_id).toBe(first.project.id)
  })

  test('filters Task triggers by the configured observed Agents', async () => {
    const fixture = createFixture()
    const other = agentStore.create({ name: 'Other Worker', type: 'dev', runtime: 'mock', projectId: fixture.project.id })
    const secretary = await createProjectSecretary({
      projectId: fixture.project.id,
      name: '任务秘书',
      definitionPrompt: '',
      reportPrompt: '',
      executionAgentId: fixture.execution.id,
      observedAgentIds: [fixture.observed.id],
      watchSessionDone: false,
      watchTaskNeedsInput: true,
    })
    events.emit('task:update', {
      taskId: 'task-other',
      data: { project_id: fixture.project.id, assigned_agent_id: other.id, status: 'needs_input' },
    })
    events.emit('task:update', {
      taskId: 'task-observed',
      data: { project_id: fixture.project.id, assigned_agent_id: fixture.observed.id, status: 'needs_input' },
    })
    expect(secretaryRunStore.list(secretary.id)).toHaveLength(1)
    expect(secretaryRunStore.list(secretary.id)[0]?.source_id).toBe('task-observed')
  })

  test('requeues a claimed run after a service restart', async () => {
    const fixture = createFixture()
    const secretary = await createProjectSecretary({
      projectId: fixture.project.id,
      name: '恢复秘书',
      definitionPrompt: '',
      reportPrompt: '',
      executionAgentId: fixture.execution.id,
      observedAgentIds: [],
      observeAll: true,
      watchSessionDone: false,
    })
    secretaryRunStore.enqueue({ secretaryId: secretary.id, eventType: 'manual', dedupeKey: 'restart-run' })
    const claimed = secretaryRunStore.claimNext(secretary.id)
    expect(claimed?.status).toBe('running')
    expect(secretaryRunStore.requeueRunning()).toBe(1)
    expect(secretaryRunStore.list(secretary.id)[0]?.status).toBe('pending')
  })

  test('drains pending runs when a secretary is re-enabled', async () => {
    const fixture = createFixture()
    const secretary = await createProjectSecretary({
      projectId: fixture.project.id,
      name: '重新启用秘书',
      definitionPrompt: '',
      reportPrompt: '',
      executionAgentId: fixture.execution.id,
      observedAgentIds: [],
      observeAll: true,
      watchSessionDone: false,
    })
    await updateProjectSecretary(secretary.id, fixture.project.id, { enabled: false })
    secretaryRunStore.enqueue({ secretaryId: secretary.id, eventType: 'manual', dedupeKey: 'reenable-run' })
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    await updateProjectSecretary(secretary.id, fixture.project.id, { enabled: true })
    await new Promise((resolveWait) => setImmediate(resolveWait))
    expect(enqueue).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('项目秘书'), undefined, expect.any(Object))
    expect(secretaryRunStore.list(secretary.id)[0]?.status).toBe('succeeded')
  })
})

function createFixture() {
  const project = projectStore.create({ name: 'Project', workDir: resolve(root, `case-${index}`) })
  const execution = agentStore.create({ name: 'Executor', type: 'pm', runtime: 'mock', projectId: project.id })
  const observed = agentStore.create({ name: 'Worker', type: 'dev', runtime: 'mock', projectId: project.id })
  const observedSession = sessionStore.create({ agentId: observed.id, projectId: project.id })
  return { project, execution, observed, observedSession }
}
