import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import '../../src/core/sessions.js'
import { events } from '../../src/core/events.js'
import { sessionStore } from '../../src/store/sessions.js'
import { taskStore } from '../../src/store/tasks.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-task-lifecycle-'))
beforeAll(() => { mkdirSync(tmp, { recursive: true }); initDatabase(resolve(tmp, 'test.sqlite')) })
afterAll(() => { closeDatabase(); rmSync(tmp, { recursive: true, force: true }) })

describe('Task ↔ Session 生命周期', () => {
  test('session:done 不会自动改变执行中任务状态', () => {
    const task = taskStore.create({ title: '实现任务闭环', assignAgentId: 'agent-1' })
    taskStore.updateStatus(task.id, 'executing', '已分派给 Agent')
    const session = sessionStore.create({ agentId: 'agent-1', taskId: task.id })

    let receivedUpdate: Record<string, unknown> | null = null
    const handler = (ev: { taskId: string; data: Record<string, unknown> }) => {
      if (ev.taskId === task.id) receivedUpdate = ev.data
    }
    events.on('task:update', handler)
    events.emit('session:done', { sessionId: session.id, agentId: 'agent-1', messageId: 'msg-done' })
    events.off('task:update', handler)

    const updated = taskStore.get(task.id)
    expect(updated?.status).toBe('executing')
    expect(updated?.stage).toBe('已分派给 Agent')
    expect(receivedUpdate).toBeNull()
  })

  test('已完成的任务不会被 session:done 覆盖', () => {
    const task = taskStore.create({ title: '已完成任务', assignAgentId: 'agent-1' })
    taskStore.updateStatus(task.id, 'completed', '人工已确认')
    const session = sessionStore.create({ agentId: 'agent-1', taskId: task.id })
    events.emit('session:done', { sessionId: session.id, agentId: 'agent-1', messageId: 'msg-done-2' })
    expect(taskStore.get(task.id)?.status).toBe('completed')
    expect(taskStore.get(task.id)?.stage).toBe('人工已确认')
  })
})
