import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { events } from '../../src/core/events.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { taskStore } from '../../src/store/tasks.js'
import { taskRpcHandlers } from '../../src/gateway/rpc/tasks.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-task-rpc-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('task RPC handlers', () => {
  test('tasks.update emits one realtime update when only status and stage change', async () => {
    const task = taskStore.create({ title: 'Update once' })
    const updates: Array<{ taskId: string; data: Record<string, unknown> }> = []
    const handler = (ev: { taskId: string; data: Record<string, unknown> }) => updates.push(ev)
    events.on('task:update', handler)

    try {
      await callTaskRpc('tasks.update', {
        type: 'tasks.update',
        taskId: task.id,
        status: 'executing',
        stage: 'Running',
      })
    } finally {
      events.off('task:update', handler)
    }

    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      taskId: task.id,
      data: { id: task.id, status: 'executing', stage: 'Running', event: 'updated' },
    })
  })

  test('tasks.assign rejects a reused session from another agent before assigning the task', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const targetAgent = agentStore.create({ name: 'Target', type: 'dev', runtime: 'mock', projectId: project.id })
    const otherAgent = agentStore.create({ name: 'Other', type: 'dev', runtime: 'mock', projectId: project.id })
    const otherSession = sessionStore.create({ agentId: otherAgent.id, projectId: project.id })
    const task = taskStore.create({ title: 'Assign safely', projectId: project.id })

    await expect(callTaskRpc('tasks.assign', {
      type: 'tasks.assign',
      taskId: task.id,
      agentId: targetAgent.id,
      sessionId: otherSession.id,
    })).rejects.toThrow('会话不属于被指派 Agent')

    const updated = taskStore.get(task.id)
    expect(updated?.assigned_agent_id).toBeNull()
    expect(updated?.status).toBe('backlog')
  })

  test('tasks.create rejects a reused session from another project without persisting a bad assignment', async () => {
    const projectA = projectStore.create({ name: 'A', workDir: resolve(tmp, 'a') })
    const projectB = projectStore.create({ name: 'B', workDir: resolve(tmp, 'b') })
    const agent = agentStore.create({ name: 'Agent A', type: 'dev', runtime: 'mock', projectId: projectA.id })
    const otherSession = sessionStore.create({ agentId: agent.id, projectId: projectB.id })

    await expect(callTaskRpc('tasks.create', {
      type: 'tasks.create',
      title: 'Create safely',
      projectId: projectA.id,
      assignAgentId: agent.id,
      sessionId: otherSession.id,
    })).rejects.toThrow('会话不属于当前项目')

    expect(taskStore.list(undefined, projectA.id)).toEqual([])
  })

  test('tasks.create rejects explicit existing mode without session before creating a task', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Target', type: 'dev', runtime: 'mock', projectId: project.id })

    await expect(callTaskRpc('tasks.create', {
      type: 'tasks.create',
      title: 'Missing session',
      projectId: project.id,
      assignAgentId: agent.id,
      sessionMode: 'existing',
    })).rejects.toThrow('existing session mode requires sessionId')

    expect(taskStore.list(undefined, project.id)).toEqual([])
  })

  test('tasks.create keeps reused session visible after task list reload', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Target', type: 'dev', runtime: 'mock', projectId: project.id })
    const existingSession = sessionStore.create({ agentId: agent.id, projectId: project.id })

    const created = await callTaskRpc('tasks.create', {
      type: 'tasks.create',
      title: 'Reuse existing',
      projectId: project.id,
      assignAgentId: agent.id,
      sessionId: existingSession.id,
    }) as Record<string, unknown>

    expect(created.sessionId).toBe(existingSession.id)

    const listed = await callTaskRpc('tasks.list', {
      type: 'tasks.list',
      projectId: project.id,
    }) as Array<Record<string, unknown>>

    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ id: created.id, sessionId: existingSession.id })
  })

  test('tasks.create treats explicit new_each as a fresh session even when sessionId is present', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Target', type: 'dev', runtime: 'mock', projectId: project.id })
    const existingSession = sessionStore.create({ agentId: agent.id, projectId: project.id })

    const created = await callTaskRpc('tasks.create', {
      type: 'tasks.create',
      title: 'Fresh task',
      projectId: project.id,
      assignAgentId: agent.id,
      sessionMode: 'new_each',
      sessionId: existingSession.id,
    }) as Record<string, unknown>

    expect(created.sessionId).toBeTruthy()
    expect(created.sessionId).not.toBe(existingSession.id)
    expect(taskStore.listSessionIds(created.id as string)).toEqual([created.sessionId])
  })

  test('tasks.assign keeps reused session visible in task detail', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Target', type: 'dev', runtime: 'mock', projectId: project.id })
    const existingSession = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const task = taskStore.create({ title: 'Assign existing', projectId: project.id })

    const assigned = await callTaskRpc('tasks.assign', {
      type: 'tasks.assign',
      taskId: task.id,
      agentId: agent.id,
      sessionId: existingSession.id,
    }) as Record<string, unknown>

    expect(assigned.sessionId).toBe(existingSession.id)

    const detail = await callTaskRpc('tasks.get', {
      type: 'tasks.get',
      taskId: task.id,
    }) as Record<string, unknown>

    expect(detail.sessions).toEqual([
      expect.objectContaining({ id: existingSession.id, agentId: agent.id }),
    ])
  })

  test('tasks.assign accepts explicit existing session mode', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Target', type: 'dev', runtime: 'mock', projectId: project.id })
    const existingSession = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const task = taskStore.create({ title: 'Assign mode', projectId: project.id })

    const assigned = await callTaskRpc('tasks.assign', {
      type: 'tasks.assign',
      taskId: task.id,
      agentId: agent.id,
      sessionMode: 'existing',
      sessionId: existingSession.id,
    }) as Record<string, unknown>

    expect(assigned.sessionId).toBe(existingSession.id)
    expect(taskStore.listSessionIds(task.id)).toEqual([existingSession.id])
  })

  test('tasks.assign rejects explicit existing mode without session before mutating the task', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Target', type: 'dev', runtime: 'mock', projectId: project.id })
    const task = taskStore.create({ title: 'Assign missing session', projectId: project.id })

    await expect(callTaskRpc('tasks.assign', {
      type: 'tasks.assign',
      taskId: task.id,
      agentId: agent.id,
      sessionMode: 'existing',
    })).rejects.toThrow('existing session mode requires sessionId')

    const updated = taskStore.get(task.id)
    expect(updated?.assigned_agent_id).toBeNull()
    expect(updated?.status).toBe('backlog')
    expect(taskStore.listSessionIds(task.id)).toEqual([])
  })
})

async function callTaskRpc(type: string, msg: Record<string, unknown>): Promise<unknown> {
  let result: unknown
  await taskRpcHandlers[type](
    msg as never,
    {
      state: { subscriptions: new Set() },
      sendResult: (data) => {
        result = data
      },
      sendError: (message) => {
        throw new Error(message)
      },
      sendOutOfBandError: (message) => {
        throw new Error(message)
      },
    },
  )
  return result
}
