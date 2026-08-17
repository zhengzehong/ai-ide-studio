import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createProjectSecretary,
  runProjectSecretaryNow,
  updateProjectSecretary,
} from '../../src/core/project-secretary.js'
import { getSecretarySession, listSecretaryRuns } from '../../src/core/project-secretary-history.js'
import { events } from '../../src/core/events.js'
import { sessionManager } from '../../src/core/sessions.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { projectSecretaryStore } from '../../src/store/project-secretaries.js'
import { secretaryMailStore } from '../../src/store/secretary-mail.js'
import { secretaryRunStore } from '../../src/store/secretary-runs.js'
import { ruleStore } from '../../src/store/rules.js'
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
    secretaryMailStore.archive(output.threadId)
    expect(secretaryMailStore.list(secretary.id)).toEqual([])
    const reopened = secretaryMailStore.upsert({
      secretaryId: secretary.id,
      threadKey: 'build',
      subject: '构建结果更新',
      bodyMarkdown: '## 新结果\n\n仍然通过',
    })
    expect(reopened).toMatchObject({ id: output.threadId, status: 'open', unread: true })
    expect(secretaryMailStore.list(secretary.id)).toHaveLength(1)
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

  test('returns bounded newest-first run summaries without payload data', async () => {
    const fixture = createFixture()
    const secretary = await createProjectSecretary({
      projectId: fixture.project.id,
      name: '历史秘书',
      definitionPrompt: '',
      reportPrompt: '',
      executionAgentId: fixture.execution.id,
      observedAgentIds: [],
      observeAll: true,
      watchSessionDone: false,
    })
    let latestId = ''
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-17T08:00:00.000Z'))
      secretaryRunStore.enqueue({
        secretaryId: secretary.id,
        eventType: 'manual',
        payload: { privateContext: 'must-not-leak' },
        dedupeKey: 'history-first',
      })
      vi.setSystemTime(new Date('2026-08-17T09:00:00.000Z'))
      const latest = secretaryRunStore.enqueue({
        secretaryId: secretary.id,
        eventType: 'cron',
        payload: { privateContext: 'must-not-leak' },
        dedupeKey: 'history-latest',
      })
      latestId = latest.id
      secretaryRunStore.finish(latest.id, 'failed', '构建失败')
    } finally {
      vi.useRealTimers()
    }

    const runs = listSecretaryRuns(secretary.id, fixture.project.id, 1)

    expect(runs).toEqual([
      expect.objectContaining({
        id: latestId,
        eventType: 'cron',
        status: 'failed',
        error: '构建失败',
      }),
    ])
    expect(JSON.stringify(runs)).not.toContain('privateContext')
    expect(JSON.stringify(runs)).not.toContain('payload_json')
  })

  test('only exposes runtime and chat Sessions owned by the selected secretary', async () => {
    const fixture = createFixture()
    const secretary = await createProjectSecretary({
      projectId: fixture.project.id,
      name: '会话秘书',
      definitionPrompt: '',
      reportPrompt: '',
      executionAgentId: fixture.execution.id,
      observedAgentIds: [],
      observeAll: true,
      watchSessionDone: false,
    })

    expect(getSecretarySession(secretary.id, fixture.project.id, secretary.runtimeSessionId!)).toMatchObject({
      id: secretary.runtimeSessionId,
      purpose: 'secretary_runtime',
    })
    expect(getSecretarySession(secretary.id, fixture.project.id, secretary.chatSessionId!)).toMatchObject({
      id: secretary.chatSessionId,
      purpose: 'secretary_chat',
    })
    expect(() => getSecretarySession(secretary.id, fixture.project.id, fixture.observedSession.id))
      .toThrow('不属于当前秘书')
  })

  test('broadcasts running and terminal run states without requiring a manual refresh', async () => {
    const fixture = createFixture()
    const secretary = await createProjectSecretary({
      projectId: fixture.project.id,
      name: '实时秘书',
      definitionPrompt: '',
      reportPrompt: '',
      executionAgentId: fixture.execution.id,
      observedAgentIds: [],
      observeAll: true,
      watchSessionDone: false,
    })
    let completePrompt: (() => void) | undefined
    vi.spyOn(sessionManager, 'enqueuePrompt').mockImplementation(() => new Promise<void>((resolvePrompt) => {
      completePrompt = resolvePrompt
    }))
    const updates: string[] = []
    const onUpdate = ({ projectId }: { projectId: string }) => updates.push(projectId)
    events.on('secretary:update', onUpdate)
    try {
      const run = runProjectSecretaryNow(secretary.id, fixture.project.id)
      await vi.waitFor(() => expect(secretaryRunStore.list(secretary.id).find((item) => item.id === run.id)?.status).toBe('running'))
      expect(updates).toHaveLength(2)
      completePrompt?.()
      await vi.waitFor(() => expect(secretaryRunStore.list(secretary.id).find((item) => item.id === run.id)?.status).toBe('succeeded'))
      expect(updates).toHaveLength(3)
    } finally {
      events.off('secretary:update', onUpdate)
    }
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

  test('synchronizes enabled state to the secretary Cron rule', async () => {
    const fixture = createFixture()
    const secretary = await createProjectSecretary({
      projectId: fixture.project.id,
      name: '定时秘书',
      definitionPrompt: '',
      reportPrompt: '',
      executionAgentId: fixture.execution.id,
      observedAgentIds: [],
      observeAll: true,
      cron: '0 9 * * *',
      watchSessionDone: false,
    })
    const rule = ruleStore.list(fixture.project.id).find((item) => item.action_config.secretary_id === secretary.id)
    expect(rule?.enabled).toBe(true)

    await updateProjectSecretary(secretary.id, fixture.project.id, { enabled: false })
    expect(ruleStore.get(rule!.id)?.enabled).toBe(false)
    await updateProjectSecretary(secretary.id, fixture.project.id, { enabled: true })
    expect(ruleStore.get(rule!.id)?.enabled).toBe(true)
  })

  test('reconfigures event triggers without recreating the secretary', async () => {
    const fixture = createFixture()
    const secretary = await createProjectSecretary({
      projectId: fixture.project.id,
      name: '触发秘书',
      definitionPrompt: '',
      reportPrompt: '',
      executionAgentId: fixture.execution.id,
      observedAgentIds: [],
      observeAll: true,
    })

    const updated = await updateProjectSecretary(secretary.id, fixture.project.id, {
      watchSessionDone: false,
      watchTaskNeedsInput: true,
    })
    expect(updated.triggers.some((item) => item.type === 'session_done')).toBe(false)
    expect(updated.triggers.some((item) => item.type === 'task_needs_input' && item.enabled)).toBe(true)
  })
})

function createFixture() {
  const project = projectStore.create({ name: 'Project', workDir: resolve(root, `case-${index}`) })
  const execution = agentStore.create({ name: 'Executor', type: 'pm', runtime: 'mock', projectId: project.id })
  const observed = agentStore.create({ name: 'Worker', type: 'dev', runtime: 'mock', projectId: project.id })
  const observedSession = sessionStore.create({ agentId: observed.id, projectId: project.id })
  return { project, execution, observed, observedSession }
}
