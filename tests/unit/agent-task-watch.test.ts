import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase, getDb } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { taskStore, taskEventStore } from '../../src/store/tasks.js'
import { taskStepStore } from '../../src/store/task-steps.js'
import { taskStepManager } from '../../src/core/task-steps.js'
import { sessionManager } from '../../src/core/sessions.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import type { ToolHandlerResult } from '../../src/tools/types.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-task-watch-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('agent.task.watch triggers', () => {
  test('step done fires watch prompt to watcher session', async () => {
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    const { project, pm, devA } = setupProject()
    const task = createTaskRow('T1', project.id, pm.id)
    const step = taskStepStore.create({ taskId: task.id, title: 'S1', assigneeAgentId: devA.id })
    taskStepStore.create({ taskId: task.id, title: 'S2', assigneeAgentId: devA.id })

    const watcherSession = sessionStore.create({ agentId: pm.id, projectId: project.id })
    await executeJson(
      'agent.task.watch',
      { taskId: task.id },
      { projectId: project.id, agentId: pm.id, sessionId: watcherSession.id },
    )

    taskStore.updateStatus(task.id, 'running', 'started')
    taskStepStore.updateStatus(step.id, 'running')
    taskStepManager.reportStep({
      taskId: task.id,
      stepId: step.id,
      agentStatus: 'done',
      reportMd: '完成了',
      agentId: devA.id,
    })

    expect(enqueue).toHaveBeenCalled()
    const promptArg = enqueue.mock.calls[0][1] as string
    expect(promptArg).toContain('任务状态已发生变化')
    expect(promptArg).toContain(task.id)
    expect(promptArg).toContain('步骤已完成')
  })

  test('step blocked fires watch prompt', async () => {
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    const { project, pm, devA } = setupProject()
    const task = createTaskRow('T1', project.id, pm.id)
    const step = taskStepStore.create({ taskId: task.id, title: 'S1', assigneeAgentId: devA.id })

    const watcherSession = sessionStore.create({ agentId: pm.id, projectId: project.id })
    await executeJson(
      'agent.task.watch',
      { taskId: task.id },
      { projectId: project.id, agentId: pm.id, sessionId: watcherSession.id },
    )

    taskStore.updateStatus(task.id, 'running', 'started')
    taskStepStore.updateStatus(step.id, 'running')
    taskStepManager.reportStep({
      taskId: task.id,
      stepId: step.id,
      agentStatus: 'blocked',
      reportMd: '卡住了',
      agentId: devA.id,
    })

    expect(enqueue).toHaveBeenCalled()
    const promptArg = enqueue.mock.calls[0][1] as string
    expect(promptArg).toContain('步骤已阻塞')
  })

  test('task completed fires watch prompt', async () => {
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    const { project, pm, devA } = setupProject()
    const task = createTaskRow('T1', project.id, pm.id)
    const step = taskStepStore.create({ taskId: task.id, title: 'S1', assigneeAgentId: devA.id })

    const watcherSession = sessionStore.create({ agentId: pm.id, projectId: project.id })
    await executeJson(
      'agent.task.watch',
      { taskId: task.id },
      { projectId: project.id, agentId: pm.id, sessionId: watcherSession.id },
    )

    taskStore.updateStatus(task.id, 'running', 'started')
    taskStepStore.updateStatus(step.id, 'running')
    taskStepManager.reportStep({
      taskId: task.id,
      stepId: step.id,
      agentStatus: 'done',
      reportMd: '完成了',
      agentId: devA.id,
    })

    expect(enqueue).toHaveBeenCalled()
    const promptArg = enqueue.mock.calls[0][1] as string
    expect(promptArg).toContain('任务整体已完成')
  })

  test('task reverted to draft fires watch prompt', async () => {
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    const { project, pm, devA } = setupProject()
    const task = createTaskRow('T1', project.id, pm.id)
    const step = taskStepStore.create({ taskId: task.id, title: 'S1', assigneeAgentId: devA.id })

    const watcherSession = sessionStore.create({ agentId: pm.id, projectId: project.id })
    await executeJson(
      'agent.task.watch',
      { taskId: task.id },
      { projectId: project.id, agentId: pm.id, sessionId: watcherSession.id },
    )

    taskStore.updateStatus(task.id, 'running', 'started')
    taskStepStore.updateStatus(step.id, 'running')
    taskStepManager.addStep({ taskId: task.id, title: 'S2' })

    expect(enqueue).toHaveBeenCalled()
    const promptArg = enqueue.mock.calls[0][1] as string
    expect(promptArg).toContain('任务已回退到草稿')
  })

  test('cancel stops future triggers', async () => {
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    const { project, pm, devA } = setupProject()
    const task = createTaskRow('T1', project.id, pm.id)
    const step = taskStepStore.create({ taskId: task.id, title: 'S1', assigneeAgentId: devA.id })

    const watcherSession = sessionStore.create({ agentId: pm.id, projectId: project.id })
    const created = await executeJson(
      'agent.task.watch',
      { taskId: task.id },
      { projectId: project.id, agentId: pm.id, sessionId: watcherSession.id },
    )

    await executeJson(
      'agent.task.watch.cancel',
      { watchId: created.watchId as string },
      { projectId: project.id, agentId: pm.id, sessionId: watcherSession.id },
    )

    taskStore.updateStatus(task.id, 'running', 'started')
    taskStepStore.updateStatus(step.id, 'running')
    taskStepManager.reportStep({
      taskId: task.id,
      stepId: step.id,
      agentStatus: 'done',
      reportMd: '完成了',
      agentId: devA.id,
    })

    expect(enqueue).not.toHaveBeenCalled()
  })

  test('milestone report does not fire watch', async () => {
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    const { project, pm, devA } = setupProject()
    const task = createTaskRow('T1', project.id, pm.id)
    const step = taskStepStore.create({ taskId: task.id, title: 'S1', assigneeAgentId: devA.id })

    const watcherSession = sessionStore.create({ agentId: pm.id, projectId: project.id })
    await executeJson(
      'agent.task.watch',
      { taskId: task.id },
      { projectId: project.id, agentId: pm.id, sessionId: watcherSession.id },
    )

    taskStore.updateStatus(task.id, 'running', 'started')
    taskStepStore.updateStatus(step.id, 'blocked')
    taskStepManager.reportStep({
      taskId: task.id,
      stepId: step.id,
      agentStatus: 'milestone',
      reportMd: '阶段性进展',
      agentId: devA.id,
    })

    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('agent.wake_me', () => {
  test('creates one-shot rule with maxRuns=1', async () => {
    const { project, devA } = setupProject()
    const session = sessionStore.create({ agentId: devA.id, projectId: project.id })
    const result = await executeJson(
      'agent.wake_me',
      { delay_seconds: 120, tips: '请继续工作' },
      { projectId: project.id, agentId: devA.id, sessionId: session.id },
    )
    expect(result.wakeId).toBeTruthy()
    expect(result.fireAt).toBeTruthy()

    const rule = getDb()
      .prepare<[string], { action: string; max_runs: number | null; enabled: number; action_config_json: string }>(
        'SELECT action, max_runs, enabled, action_config_json FROM rules WHERE id = ?',
      )
      .get(result.wakeId as string)
    expect(rule).toMatchObject({ action: 'send_prompt', max_runs: 1, enabled: 1 })
    const config = JSON.parse(rule!.action_config_json)
    expect(config.agent_id).toBe(devA.id)
    expect(config.session_id).toBe(session.id)
    expect(config.session_mode).toBe('existing')
    expect(config.prompt).toBe('请继续工作')
  })

  test('rejects delay less than 60 seconds', async () => {
    const { project, devA } = setupProject()
    const session = sessionStore.create({ agentId: devA.id, projectId: project.id })
    const handler = getHandler('agent.wake_me')!
    const result: ToolHandlerResult = await handler.execute(
      { delay_seconds: 30, tips: 'x' },
      { projectId: project.id, agentId: devA.id, sessionId: session.id },
    )
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
    expect(parsed.error).toContain('60')
  })
})

function setupProject(): { project: ReturnType<typeof projectStore.create>; pm: ReturnType<typeof agentStore.create>; devA: ReturnType<typeof agentStore.create> } {
  const project = projectStore.create({ name: 'P', workDir: tmp })
  const pm = agentStore.create({ name: 'PM', type: 'leader', runtime: 'mock', projectId: project.id })
  const devA = agentStore.create({ name: 'DevA', type: 'dev', runtime: 'mock', projectId: project.id })
  return { project, pm, devA }
}

function createTaskRow(title: string, projectId: string, assigneeId: string): ReturnType<typeof taskStore.create> {
  const task = taskStore.create({ title, description: 'd', projectId, assignAgentId: assigneeId, source: 'manual' })
  taskEventStore.append(task.id, { type: 'task_created', payload: {} })
  return task
}

async function executeJson(
  handlerName: string,
  input: Record<string, unknown>,
  context: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const handler = getHandler(handlerName)
  if (!handler) throw new Error(`handler missing: ${handlerName}`)
  const result: ToolHandlerResult = await handler.execute(input, context)
  if (result.isError) {
    throw new Error(`handler ${handlerName} returned error: ${result.content[0]?.text}`)
  }
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}
