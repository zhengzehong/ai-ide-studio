import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { eventStore, messageStore, sessionStore } from '../../src/store/sessions.js'
import { taskStore } from '../../src/store/tasks.js'
import { taskStepStore } from '../../src/store/task-steps.js'
import { taskStepManager } from '../../src/core/task-steps.js'
import { events } from '../../src/core/events.js'
import { widgetRpcHandlers } from '../../src/gateway/rpc/widget.js'
import type { RpcContext } from '../../src/gateway/rpc/types.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-widget-'))

beforeEach(() => {
  closeDatabase()
  initDatabase(resolve(tmp, `test-${Date.now()}-${Math.random()}.sqlite`))
})

afterEach(() => {
  closeDatabase()
})

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

async function callWidgetRpc(type: string, msg: Record<string, unknown> = {}): Promise<unknown> {
  const handler = widgetRpcHandlers[type]
  if (!handler) throw new Error(`Missing handler: ${type}`)

  return new Promise((resolveResult, reject) => {
    const context: RpcContext = {
      state: { subscriptions: new Set() },
      sendResult: resolveResult,
      sendError: (message) => reject(new Error(message)),
      sendOutOfBandError: (message) => reject(new Error(message)),
    }
    Promise.resolve(handler({ type, ...msg }, context)).catch(reject)
  })
}

describe('widget session RPC', () => {
  test('lists running sessions from persisted runtime state instead of agent runtime status', async () => {
    const project = projectStore.create({ name: 'Widget Project', workDir: 'D:/work/widget' })
    const agent = agentStore.create({ name: 'Codex', type: 'dev', runtime: 'mock', projectId: project.id, icon: 'code' })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    messageStore.append(session.id, { id: 'msg-running-widget', role: 'agent', content: 'partial output', status: 'running' })

    const rows = await callWidgetRpc('widget.sessions.list') as Array<Record<string, unknown>>

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sessionId: session.id,
      agentId: agent.id,
      agentName: 'Codex',
      agentIcon: 'code',
      projectId: project.id,
      projectName: 'Widget Project',
      activityState: 'running',
      stage: '',
      unread: false,
    })
  })

  test('reports idle runtime state when a session finishes', async () => {
    const project = projectStore.create({ name: 'Done Project', workDir: 'D:/work/done' })
    const agent = agentStore.create({ name: 'Done Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    events.emit('session:done', {
      sessionId: session.id,
      agentId: agent.id,
      messageId: 'done-without-idle',
      stopReason: 'end_turn',
    })

    const rows = await callWidgetRpc('widget.sessions.list', { filter: 'all' }) as Array<Record<string, unknown>>

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sessionId: session.id,
      activityState: 'idle',
    })
  })

  test('lists unread completed sessions and markRead hides them from active filter', async () => {
    const project = projectStore.create({ name: 'Unread Project', workDir: 'D:/work/unread' })
    const agent = agentStore.create({ name: 'Claude', type: 'dev', runtime: 'mock', projectId: project.id })
    const task = taskStore.create({ title: '修复登录问题', projectId: project.id, assignAgentId: agent.id })
    const session = sessionStore.create({ agentId: agent.id, taskId: task.id, projectId: project.id })
    messageStore.append(session.id, { role: 'agent', content: '已经修复', status: 'completed' })
    sessionStore.touch(session.id)
    getDb()
      .prepare('UPDATE sessions SET last_read_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', session.id)
    events.emit('session:done', {
      sessionId: session.id,
      agentId: agent.id,
      messageId: 'msg-done',
      stopReason: 'end_turn',
    })

    const unreadRows = await callWidgetRpc('widget.sessions.list') as Array<Record<string, unknown>>

    expect(unreadRows).toHaveLength(1)
    expect(unreadRows[0]).toMatchObject({
      sessionId: session.id,
      taskId: task.id,
      taskTitle: '修复登录问题',
      activityState: 'idle',
      unread: true,
    })

    const changed: Array<{ sessionId: string; data: Record<string, unknown> }> = []
    const onChanged = (event: { sessionId: string; data: Record<string, unknown> }): void => {
      changed.push(event)
    }
    events.on('session:changed', onChanged)
    await callWidgetRpc('widget.sessions.markRead', { sessionId: session.id })
    events.off('session:changed', onChanged)
    const afterRead = await callWidgetRpc('widget.sessions.list') as Array<Record<string, unknown>>

    expect(afterRead).toEqual([])
    expect(changed.at(-1)).toMatchObject({
      sessionId: session.id,
      data: { last_read_at: expect.any(String) },
    })
    expect(changed.at(-1)?.data).not.toHaveProperty('lastReadAt')
  })

  test('uses message.done events as a recent completion fallback without inventing unread state', async () => {
    const project = projectStore.create({ name: 'Event Project', workDir: 'D:/work/event' })
    const agent = agentStore.create({ name: 'Event Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })

    eventStore.append(session.id, {
      type: 'message.done',
      agentId: agent.id,
      messageId: 'done-event',
      role: 'agent',
      payload: { messageId: 'done-event', stopReason: 'end_turn' },
    })

    const rows = await callWidgetRpc('widget.sessions.list', { filter: 'recent' }) as Array<Record<string, unknown>>

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sessionId: session.id,
      unread: false,
      activityState: 'idle',
      completedAt: expect.any(String),
    })
  })

  test('uses a newer message.done event for completion time but not message unread state', async () => {
    const project = projectStore.create({ name: 'Later Event Project', workDir: 'D:/work/later-event' })
    const agent = agentStore.create({ name: 'Later Event Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const message = messageStore.append(session.id, { role: 'agent', content: 'message before read', status: 'completed' })
    getDb()
      .prepare('UPDATE messages SET timestamp = ?, completed_at = ? WHERE id = ?')
      .run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', message.id)
    getDb()
      .prepare('INSERT INTO widget_read_state (session_id, read_at) VALUES (?, ?)')
      .run(session.id, '2026-01-01T00:00:01.000Z')
    const doneEvent = eventStore.append(session.id, {
      type: 'message.done',
      agentId: agent.id,
      messageId: 'done-after-read',
      role: 'agent',
      payload: { messageId: 'done-after-read', stopReason: 'end_turn' },
    })
    getDb()
      .prepare('UPDATE session_events SET created_at = ? WHERE id = ?')
      .run('2026-01-01T00:00:02.000Z', doneEvent.id)

    const rows = await callWidgetRpc('widget.sessions.list', { filter: 'recent' }) as Array<Record<string, unknown>>

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sessionId: session.id,
      completedAt: '2026-01-01T00:00:02.000Z',
      unread: false,
    })
  })

  test('filters sessions by project', async () => {
    const projectA = projectStore.create({ name: 'A', workDir: 'D:/work/a' })
    const projectB = projectStore.create({ name: 'B', workDir: 'D:/work/b' })
    const agentA = agentStore.create({ name: 'Agent A', type: 'dev', runtime: 'mock', projectId: projectA.id })
    const agentB = agentStore.create({ name: 'Agent B', type: 'dev', runtime: 'mock', projectId: projectB.id })
    const sessionA = sessionStore.create({ agentId: agentA.id, projectId: projectA.id })
    const sessionB = sessionStore.create({ agentId: agentB.id, projectId: projectB.id })
    getDb()
      .prepare('UPDATE sessions SET last_read_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', sessionA.id)
    messageStore.append(sessionA.id, { role: 'agent', content: 'A done', status: 'completed' })
    sessionStore.touch(sessionA.id)
    messageStore.append(sessionB.id, { role: 'agent', content: 'B done', status: 'completed' })
    sessionStore.touch(sessionB.id)

    const rows = await callWidgetRpc('widget.sessions.list', { projectId: projectA.id }) as Array<Record<string, unknown>>

    expect(rows.map((row) => row.sessionId)).toEqual([sessionA.id])
  })

  test('does not list archived sessions', async () => {
    const project = projectStore.create({ name: 'Archived Project', workDir: 'D:/work/archived' })
    const agent = agentStore.create({ name: 'Archived Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    messageStore.append(session.id, { role: 'agent', content: 'done before archive', status: 'completed' })
    sessionStore.touch(session.id)
    sessionStore.archive(session.id)

    const activeRows = await callWidgetRpc('widget.sessions.list') as Array<Record<string, unknown>>
    const allRows = await callWidgetRpc('widget.sessions.list', { filter: 'all' }) as Array<Record<string, unknown>>

    expect(activeRows).toEqual([])
    expect(allRows).toEqual([])
  })

  test('uses the shared Session read timestamp instead of Widget-only read state', async () => {
    const project = projectStore.create({ name: 'Shared Read Project', workDir: 'D:/work/shared-read' })
    const agent = agentStore.create({ name: 'Shared Read Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const message = messageStore.append(session.id, { role: 'agent', content: 'already read on PC', status: 'completed' })
    getDb()
      .prepare('UPDATE messages SET timestamp = ?, completed_at = ? WHERE id = ?')
      .run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', message.id)
    getDb()
      .prepare('UPDATE sessions SET last_read_at = ? WHERE id = ?')
      .run('2026-01-01T00:00:01.000Z', session.id)

    const rows = await callWidgetRpc('widget.sessions.list', { filter: 'recent' }) as Array<Record<string, unknown>>

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sessionId: session.id, unread: false })
  })

  test('keeps a read completed Session in the bounded recent view', async () => {
    const project = projectStore.create({ name: 'Recent Project', workDir: 'D:/work/recent' })
    const agent = agentStore.create({ name: 'Recent Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    messageStore.append(session.id, { role: 'agent', content: 'recent result', status: 'completed' })
    sessionStore.touch(session.id)

    await callWidgetRpc('widget.sessions.markRead', { sessionId: session.id })
    const activeRows = await callWidgetRpc('widget.sessions.list') as Array<Record<string, unknown>>
    const recentRows = await callWidgetRpc('widget.sessions.list', { filter: 'recent' }) as Array<Record<string, unknown>>

    expect(activeRows).toEqual([])
    expect(recentRows).toHaveLength(1)
    expect(recentRows[0]).toMatchObject({ sessionId: session.id, unread: false })
  })

  test('limits the recent view to twenty Sessions', async () => {
    const project = projectStore.create({ name: 'Bounded Project', workDir: 'D:/work/bounded' })
    const agent = agentStore.create({ name: 'Bounded Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    for (let index = 0; index < 21; index += 1) {
      const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
      messageStore.append(session.id, { role: 'agent', content: `result ${index}`, status: 'completed' })
    }

    const rows = await callWidgetRpc('widget.sessions.list', {
      projectId: project.id,
      filter: 'recent',
    }) as Array<Record<string, unknown>>

    expect(rows).toHaveLength(20)
  })
})

describe('widget Agent activity RPC', () => {
  test('returns one row per Agent and prioritizes a running Session as the navigation target', async () => {
    const project = projectStore.create({ name: 'Activity Project', workDir: 'D:/work/activity' })
    const agent = agentStore.create({ name: 'Activity Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const runningTask = taskStore.create({ title: 'Active implementation', projectId: project.id, assignAgentId: agent.id })
    taskStore.assignAgent(runningTask.id, agent.id)
    const runningSession = sessionStore.create({ agentId: agent.id, taskId: runningTask.id, projectId: project.id })
    messageStore.append(runningSession.id, { role: 'agent', content: 'working', status: 'running' })
    const recentSession = sessionStore.create({ agentId: agent.id, projectId: project.id })
    messageStore.append(recentSession.id, { role: 'agent', content: 'recent result', status: 'completed' })
    sessionStore.touch(recentSession.id, '2026-07-31T10:00:00.000Z')

    const rows = await callWidgetRpc('widget.agentActivity.list') as Array<Record<string, unknown>>

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      agentId: agent.id,
      projectId: project.id,
      sessionId: runningSession.id,
      taskId: runningTask.id,
      taskTitle: 'Active implementation',
      activityState: 'running',
    })
  })

  test('prioritizes a needs-input Task over an unread completed Session', async () => {
    const project = projectStore.create({ name: 'Attention Project', workDir: 'D:/work/attention' })
    const agent = agentStore.create({ name: 'Attention Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const attentionTask = taskStore.create({ title: 'Confirm rollout', projectId: project.id, assignAgentId: agent.id })
    taskStore.assignAgent(attentionTask.id, agent.id)
    taskStore.update(attentionTask.id, { status: 'needs_input' })
    const attentionSession = sessionStore.create({ agentId: agent.id, taskId: attentionTask.id, projectId: project.id })
    messageStore.append(attentionSession.id, { role: 'agent', content: 'need approval', status: 'completed' })
    const unreadSession = sessionStore.create({ agentId: agent.id, projectId: project.id })
    messageStore.append(unreadSession.id, { role: 'agent', content: 'unread result', status: 'completed' })
    getDb().prepare('UPDATE sessions SET last_read_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', unreadSession.id)
    sessionStore.touch(unreadSession.id, '2026-07-31T11:00:00.000Z')

    const rows = await callWidgetRpc('widget.agentActivity.list') as Array<Record<string, unknown>>

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sessionId: attentionSession.id,
      taskId: attentionTask.id,
      taskStatus: 'needs_input',
      activityState: 'needs_input',
      unreadCount: 1,
    })
  })

  test('orders Agents by representative activity and filters by project', async () => {
    const projectA = projectStore.create({ name: 'Project A', workDir: 'D:/work/project-a' })
    const projectB = projectStore.create({ name: 'Project B', workDir: 'D:/work/project-b' })
    const olderAgent = agentStore.create({ name: 'Older Agent', type: 'dev', runtime: 'mock', projectId: projectA.id })
    const newerAgent = agentStore.create({ name: 'Newer Agent', type: 'dev', runtime: 'mock', projectId: projectA.id })
    const otherAgent = agentStore.create({ name: 'Other Agent', type: 'dev', runtime: 'mock', projectId: projectB.id })
    const older = sessionStore.create({ agentId: olderAgent.id, projectId: projectA.id })
    const newer = sessionStore.create({ agentId: newerAgent.id, projectId: projectA.id })
    const other = sessionStore.create({ agentId: otherAgent.id, projectId: projectB.id })
    messageStore.append(older.id, { role: 'agent', content: 'older', status: 'completed' })
    messageStore.append(newer.id, { role: 'agent', content: 'newer', status: 'completed' })
    messageStore.append(other.id, { role: 'agent', content: 'other', status: 'completed' })
    sessionStore.touch(older.id, '2026-07-31T09:00:00.000Z')
    sessionStore.touch(newer.id, '2026-07-31T10:00:00.000Z')
    sessionStore.touch(other.id, '2026-07-31T12:00:00.000Z')

    const rows = await callWidgetRpc('widget.agentActivity.list', { projectId: projectA.id }) as Array<Record<string, unknown>>

    expect(rows.map((row) => row.agentId)).toEqual([newerAgent.id, olderAgent.id])
  })

  test('associates the latest Task assigned to an Agent today when its Session has no task_id', async () => {
    const project = projectStore.create({ name: 'Today Project', workDir: 'D:/work/today' })
    const agent = agentStore.create({ name: 'Today Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    messageStore.append(session.id, { role: 'agent', content: 'recent result', status: 'completed' })
    const older = taskStore.create({ title: 'Earlier today', projectId: project.id })
    taskStore.assignAgent(older.id, agent.id)
    const latest = taskStore.create({ title: 'Latest today', projectId: project.id })
    taskStore.assignAgent(latest.id, agent.id)

    const rows = await callWidgetRpc('widget.agentActivity.list', { projectId: project.id }) as Array<Record<string, unknown>>

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sessionId: session.id,
      taskId: latest.id,
      taskTitle: 'Latest today',
    })
  })

  test('associates a Task through an Agent-owned step', async () => {
    const project = projectStore.create({ name: 'Step Project', workDir: 'D:/work/step' })
    const agent = agentStore.create({ name: 'Step Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    messageStore.append(session.id, { role: 'agent', content: 'step result', status: 'completed' })
    const task = taskStore.create({ title: 'Step-owned Task', projectId: project.id })
    taskStepStore.create({
      taskId: task.id,
      title: 'Implement',
      assigneeAgentId: agent.id,
      sessionId: session.id,
    })

    const rows = await callWidgetRpc('widget.agentActivity.list', { projectId: project.id }) as Array<Record<string, unknown>>

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      taskId: task.id,
      taskTitle: 'Step-owned Task',
    })
  })

  test('does not associate a Task that was assigned before today', async () => {
    const project = projectStore.create({ name: 'Old Task Project', workDir: 'D:/work/old-task' })
    const agent = agentStore.create({ name: 'Old Task Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    messageStore.append(session.id, { role: 'agent', content: 'recent result', status: 'completed' })
    const task = taskStore.create({ title: 'Yesterday Task', projectId: project.id })
    taskStore.assignAgent(task.id, agent.id)
    getDb().prepare('UPDATE tasks SET created_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', task.id)
    getDb().prepare('UPDATE task_events SET created_at = ? WHERE task_id = ?')
      .run('2000-01-01T00:00:00.000Z', task.id)

    const rows = await callWidgetRpc('widget.agentActivity.list', { projectId: project.id }) as Array<Record<string, unknown>>

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      taskId: null,
      taskTitle: null,
      taskStatus: null,
    })
  })

  test('associates an older Team Task reassigned to the Agent today', async () => {
    const project = projectStore.create({ name: 'Reassigned Project', workDir: 'D:/work/reassigned' })
    const agent = agentStore.create({ name: 'Reassigned Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    messageStore.append(session.id, { role: 'agent', content: 'reassigned result', status: 'completed' })
    const task = taskStore.create({ title: 'Reassigned today', projectId: project.id })
    getDb().prepare('UPDATE tasks SET created_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', task.id)

    taskStore.update(task.id, { assignAgentId: agent.id })
    const rows = await callWidgetRpc('widget.agentActivity.list', { projectId: project.id }) as Array<Record<string, unknown>>

    expect(rows[0]).toMatchObject({
      taskId: task.id,
      taskTitle: 'Reassigned today',
    })
  })

  test('associates an older step reassigned to the Agent today', async () => {
    const project = projectStore.create({ name: 'Step Reassignment Project', workDir: 'D:/work/step-reassignment' })
    const previousAgent = agentStore.create({ name: 'Previous Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const agent = agentStore.create({ name: 'New Step Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    messageStore.append(session.id, { role: 'agent', content: 'step reassigned result', status: 'completed' })
    const task = taskStore.create({ title: 'Step reassigned today', projectId: project.id })
    const step = taskStepStore.create({
      taskId: task.id,
      title: 'Older step',
      assigneeAgentId: previousAgent.id,
    })
    getDb().prepare('UPDATE task_steps SET created_at = ?, updated_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z', step.id)

    taskStepManager.updateStep({ taskId: task.id, stepId: step.id, assignee: agent.id })
    const rows = await callWidgetRpc('widget.agentActivity.list', { projectId: project.id }) as Array<Record<string, unknown>>

    expect(rows[0]).toMatchObject({
      taskId: task.id,
      taskTitle: 'Step reassigned today',
    })
  })

  test('does not treat editing an older step as assigning it today', async () => {
    const project = projectStore.create({ name: 'Step Edit Project', workDir: 'D:/work/step-edit' })
    const agent = agentStore.create({ name: 'Step Edit Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    messageStore.append(session.id, { role: 'agent', content: 'older step result', status: 'completed' })
    const task = taskStore.create({ title: 'Older assigned step', projectId: project.id })
    const step = taskStepStore.create({
      taskId: task.id,
      title: 'Original title',
      assigneeAgentId: agent.id,
    })
    getDb().prepare('UPDATE task_steps SET created_at = ?, updated_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z', step.id)

    taskStepManager.updateStep({
      taskId: task.id,
      stepId: step.id,
      title: 'Edited today',
      assignee: agent.id,
    })
    const rows = await callWidgetRpc('widget.agentActivity.list', { projectId: project.id }) as Array<Record<string, unknown>>

    expect(rows[0]).toMatchObject({
      taskId: null,
      taskTitle: null,
      taskStatus: null,
    })
  })

  test('limits the activity view to twenty Agents', async () => {
    const project = projectStore.create({ name: 'Bounded Agents', workDir: 'D:/work/bounded-agents' })
    for (let index = 0; index < 21; index += 1) {
      const agent = agentStore.create({ name: `Agent ${index}`, type: 'dev', runtime: 'mock', projectId: project.id })
      const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
      messageStore.append(session.id, { role: 'agent', content: `result ${index}`, status: 'completed' })
    }

    const rows = await callWidgetRpc('widget.agentActivity.list', { projectId: project.id }) as Array<Record<string, unknown>>

    expect(rows).toHaveLength(20)
  })
})
