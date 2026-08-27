import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { taskStore } from '../../src/store/tasks.js'
import { taskStepStore } from '../../src/store/task-steps.js'
import { eventStore, messageStore, sessionStore } from '../../src/store/sessions.js'
import { turnProcessItemStore } from '../../src/store/turn-process-items.js'
import { createLocalQueryPort } from '../../src/queries/local-query-port.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-query-read-model-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('local QueryPort read models', () => {
  test('task list keeps projection queries constant as task count grows', async () => {
    const projectId = 'project-query-performance'
    let expectedSessionId = ''

    for (let index = 0; index < 30; index += 1) {
      const task = taskStore.create({
        title: `Task ${index}`,
        description: `Task ${index}`,
        projectId,
      })
      const first = taskStepStore.create({ taskId: task.id, title: `Step ${index}.1` })
      const second = taskStepStore.create({
        taskId: task.id,
        title: `Step ${index}.2`,
        dependsOn: [first.id],
      })
      taskStepStore.updateStatus(first.id, 'done')
      const session = sessionStore.create({
        agentId: `agent-${index}`,
        taskId: task.id,
        projectId,
      })
      if (index === 29) expectedSessionId = session.id
      expect(second.task_id).toBe(task.id)
    }

    const db = getDb()
    const prepareSpy = vi.spyOn(db, 'prepare')
    const queryPort = createLocalQueryPort()

    const tasks = await queryPort.listTasks({ projectId })

    expect(tasks).toHaveLength(30)
    expect(tasks[0]).toMatchObject({
      sessionId: expectedSessionId,
      stepProgress: { done: 1, total: 2 },
    })
    expect(tasks[0].steps).toHaveLength(2)
    expect(tasks[0].steps[1].dependsOn).toEqual([tasks[0].steps[0].id])
    expect(prepareSpy.mock.calls.length).toBeLessThanOrEqual(7)
    prepareSpy.mockRestore()
  })

  test('task summaries stay bounded when descriptions are large', async () => {
    const projectId = 'project-task-response-budget'
    const description = `Long task body: ${'x'.repeat(4096)}`
    for (let index = 0; index < 262; index += 1) {
      taskStore.create({ title: `Large task ${index}`, description, projectId })
    }

    const tasks = await createLocalQueryPort().listTasks({ projectId })
    const responseBytes = Buffer.byteLength(JSON.stringify(tasks), 'utf8')

    expect(tasks).toHaveLength(262)
    expect(tasks.every((task) => !('description' in task))).toBe(true)
    expect(tasks.every((task) => task.descriptionPreview.length <= 240)).toBe(true)
    expect(responseBytes).toBeLessThan(512 * 1024)
  })

  test('session list resolves all persisted running signals with one SQL statement', async () => {
    const projectId = 'project-session-performance'
    const sessions = Array.from({ length: 30 }, (_, index) => sessionStore.create({
      agentId: `agent-${index}`,
      projectId,
    }))
    const promptSession = sessions[0]
    const messageSession = sessions[1]
    const processSession = sessions[2]

    const runningMessage = messageStore.append(messageSession.id, {
      role: 'agent',
      content: 'running',
      status: 'running',
    })
    const processMessage = messageStore.append(processSession.id, {
      role: 'agent',
      content: '',
      status: 'completed',
    })
    turnProcessItemStore.upsert({
      id: 'process-running',
      sessionId: processSession.id,
      messageId: processMessage.id,
      kind: 'tool',
      status: 'running',
    })
    expect(runningMessage.status).toBe('running')

    const db = getDb()
    const prepareSpy = vi.spyOn(db, 'prepare')
    const queryPort = createLocalQueryPort({
      isPromptActive: (sessionId) => sessionId === promptSession.id,
    })

    const listed = await queryPort.listSessions({ projectId })

    expect(listed.filter((session) => session.activity_state === 'running').map((session) => session.id).sort())
      .toEqual([messageSession.id, processSession.id, promptSession.id].sort())
    expect(prepareSpy.mock.calls.length).toBe(1)
    prepareSpy.mockRestore()
  })

  test('Widget completion uses finalized Agent messages instead of message.done events', async () => {
    const project = projectStore.create({ name: 'Widget Project', workDir: 'D:/widget' })
    const agent = agentStore.create({
      name: 'Widget Agent',
      type: 'dev',
      runtime: 'mock',
      projectId: project.id,
    })
    const eventOnlySession = sessionStore.create({ agentId: agent.id, projectId: project.id })
    eventStore.append(eventOnlySession.id, {
      type: 'message.done',
      agentId: agent.id,
      messageId: 'event-only',
      role: 'agent',
      payload: { stopReason: 'end_turn' },
    })
    const completedSession = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const completedMessage = messageStore.append(completedSession.id, {
      role: 'agent',
      content: 'finished',
      status: 'completed',
    })
    getDb().prepare('UPDATE messages SET timestamp = ? WHERE id = ?')
      .run('2026-08-27T08:00:00.000Z', completedMessage.id)

    const rows = await createLocalQueryPort().listWidgetSessions({ projectId: project.id })
    const byId = new Map(rows.map((row) => [row.sessionId, row]))

    expect(byId.get(eventOnlySession.id)?.completedAt).toBeNull()
    expect(byId.get(completedSession.id)?.completedAt).toBe('2026-08-27T08:00:00.000Z')
  })

  test('Widget session projection resolves links and running state with one SQL statement', async () => {
    const project = projectStore.create({ name: 'Widget Projection', workDir: 'D:/widget-projection' })
    const agent = agentStore.create({
      name: 'Projection Agent',
      type: 'dev',
      runtime: 'mock',
      projectId: project.id,
    })
    const task = taskStore.create({ title: 'Projection Task', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    taskStepStore.create({ taskId: task.id, title: 'Projection Step', sessionId: session.id })
    messageStore.append(session.id, { role: 'agent', content: 'working', status: 'running' })
    const db = getDb()
    const prepareSpy = vi.spyOn(db, 'prepare')

    const rows = await createLocalQueryPort().listWidgetSessions({
      projectId: project.id,
      activePromptSessionIds: [session.id],
    })

    expect(rows).toMatchObject([{
      sessionId: session.id,
      agentId: agent.id,
      agentName: 'Projection Agent',
      projectId: project.id,
      projectName: 'Widget Projection',
      taskId: task.id,
      taskTitle: 'Projection Task',
      activityState: 'running',
    }])
    expect(prepareSpy).toHaveBeenCalledTimes(1)
    prepareSpy.mockRestore()
  })

  test('message and recovery event pages expose non-skipping cursors', async () => {
    const session = sessionStore.create({ agentId: 'agent-history' })
    const timestamps = [
      '2026-07-19T00:00:01.000Z',
      '2026-07-19T00:00:02.000Z',
      '2026-07-19T00:00:03.000Z',
      '2026-07-19T00:00:04.000Z',
    ]
    const messages = timestamps.map((timestamp, index) => {
      const message = messageStore.append(session.id, { role: 'user', content: `message-${index}` })
      getDb().prepare('UPDATE messages SET timestamp = ? WHERE id = ?').run(timestamp, message.id)
      return { ...message, timestamp }
    })
    for (let index = 0; index < 5; index += 1) {
      eventStore.append(session.id, {
        type: 'message.chunk',
        messageId: `message-${index}`,
        payload: { content: String(index) },
      })
    }
    const queryPort = createLocalQueryPort()

    const messagePage = await queryPort.listSessionMessages({ sessionId: session.id, limit: 2 })
    const eventPage = await queryPort.listSessionEvents({ sessionId: session.id, limit: 2, afterSequence: 1 })

    expect(messagePage.items.map((message) => message.id)).toEqual([messages[2].id, messages[3].id])
    expect(messagePage).toMatchObject({ hasMore: true, nextCursor: timestamps[2] })
    expect(eventPage.items.map((event) => event.sequence)).toEqual([2, 3])
    expect(eventPage).toMatchObject({ hasMore: true, nextCursor: '3' })
  })

  test('migration installs indexes used by the hot read models', () => {
    const indexNames = new Set(
      getDb()
        .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((row) => row.name),
    )

    expect(indexNames).toEqual(expect.objectContaining(new Set([
      'idx_messages_session_role_status',
      'idx_turn_process_items_session_status',
      'idx_sessions_task_started',
      'idx_task_events_type_task_sequence',
      'idx_tasks_project_status_created',
    ])))
  })
})
