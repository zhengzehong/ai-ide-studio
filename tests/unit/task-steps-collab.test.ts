import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import { taskStore, taskEventStore } from '../../src/store/tasks.js'
import { taskStepStore, detectCycle, type TaskStepRow } from '../../src/store/task-steps.js'
import { taskStepManager, buildStepPrompt } from '../../src/core/task-steps.js'
import { reportStepAndDispatch } from '../../src/core/task-step-report.js'
import { sessionManager } from '../../src/core/sessions.js'
import { taskRpcHandlers } from '../../src/gateway/rpc/tasks.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import type { ToolHandlerResult } from '../../src/tools/types.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-task-steps-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

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

function expectError(result: ToolHandlerResult, messageFragment?: string): Record<string, unknown> {
  if (!result.isError) throw new Error('expected error result, got success')
  const parsed = JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
  if (messageFragment) {
    expect(String(parsed.error)).toContain(messageFragment)
  }
  return parsed
}

function setupProject(): {
  project: ReturnType<typeof projectStore.create>
  agents: ReturnType<typeof agentStore.create>[]
} {
  const project = projectStore.create({ name: 'P', workDir: tmp })
  const pm = agentStore.create({ name: 'PM', type: 'leader', runtime: 'mock', projectId: project.id })
  const devA = agentStore.create({ name: 'DevA', type: 'dev', runtime: 'mock', projectId: project.id })
  const devB = agentStore.create({ name: 'DevB', type: 'dev', runtime: 'mock', projectId: project.id })
  const tester = agentStore.create({ name: 'Tester', type: 'dev', runtime: 'mock', projectId: project.id })
  return { project, agents: [pm, devA, devB, tester] }
}

function createTaskRow(title: string, projectId: string): ReturnType<typeof taskStore.create> {
  return taskStore.create({ title, source: 'agent', projectId })
}

async function setupRunningTwoStepChain(
  projectId: string,
  firstAssignee: string,
  nextAssignee: string,
): Promise<{ task: ReturnType<typeof taskStore.create>; firstStep: TaskStepRow; nextStep: TaskStepRow }> {
  const task = createTaskRow('两个 step', projectId)
  const first = taskStepManager.addStep({ taskId: task.id, title: 's1', assignee: firstAssignee })
  const next = taskStepManager.addStep({
    taskId: task.id,
    title: 's2',
    assignee: nextAssignee,
    dependsOn: [first.step.id],
  })
  taskStore.updateStatus(task.id, 'running', '已启动')
  taskStepStore.updateStatus(first.step.id, 'ready')
  await taskStepManager.dispatchStep(task.id, first.step.id)
  return {
    task,
    firstStep: taskStepStore.get(first.step.id)!,
    nextStep: taskStepStore.get(next.step.id)!,
  }
}

describe('studio.task.createSimple - 简单任务创建', () => {
  test('创建简单任务:自动建默认 step + 自动 start + 立即派发', async () => {
    const { project, agents } = setupProject()
    const [pm, devA] = agents
    const result = await executeJson(
      'studio.task.createSimple',
      { title: '修个 typo', description: 'README 拼错', selfExecute: false, assignee: devA.id },
      { projectId: project.id, agentId: pm.id, sessionId: 'sess-test' },
    )

    expect(result.taskId).toBeTruthy()
    expect(result.defaultStepId).toBeTruthy()
    expect(result.status).toBe('running')

    const task = taskStore.get(result.taskId as string)!
    expect(task.status).toBe('running')

    const steps = taskStepStore.listByTask(task.id)
    expect(steps).toHaveLength(1)
    expect(steps[0].status).toBe('running')
    expect(steps[0].assignee_agent_id).toBe(devA.id)

    const events = taskEventStore.list(task.id)
    expect(events.some((e) => e.type === 'step_added')).toBe(true)
  })
})

describe('studio.task.createSimple selfExecute - 对话任务化', () => {
  test('selfExecute=true 创建默认 step 并复用当前会话且不注入 prompt', async () => {
    const { project, agents } = setupProject()
    const [pm, devA] = agents
    const session = sessionStore.create({ agentId: pm.id, projectId: project.id })
    const ignoredSession = sessionStore.create({ agentId: devA.id, projectId: project.id })

    const created = await executeJson(
      'studio.task.createSimple',
      {
        title: '修 README typo',
        description: 'README 中 ai-ide-studio 拼写错误',
        selfExecute: true,
        assignee: devA.id,
        sessionId: ignoredSession.id,
        projectId: 'proj-ignored',
      },
      { projectId: project.id, agentId: pm.id, sessionId: session.id },
    )

    expect(created.taskId).toBeTruthy()
    expect(created.defaultStepId).toBeTruthy()
    expect(created.status).toBe('running')
    expect(created.sessionId).toBe(session.id)

    const task = taskStore.get(created.taskId as string)!
    expect(task.status).toBe('running')
    expect(task.project_id).toBe(project.id)
    expect(task.assigned_agent_id).toBe(pm.id)
    expect(task.agent_report_status).toBe('in_progress')

    const steps = taskStepStore.listByTask(task.id)
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({
      id: created.defaultStepId,
      title: '修 README typo',
      description: 'README 中 ai-ide-studio 拼写错误',
      status: 'running',
      assignee_agent_id: pm.id,
      session_id: session.id,
    })
    expect(taskStepStore.listDependencies(steps[0].id)).toEqual([])
    expect(taskStore.listSessionIds(task.id)).toEqual([session.id])
    expect(messageStore.list(session.id)).toEqual([])
    expect(messageStore.list(ignoredSession.id)).toEqual([])
  })

  test('selfExecute=true requires current Agent and session context', async () => {
    const { project } = setupProject()

    await expect(
      executeJson(
        'studio.task.createSimple',
        { title: 'Self task', description: 'Missing context', selfExecute: true },
        { projectId: project.id },
      ),
    ).rejects.toThrow('selfExecute=true')
  })

  test('selfExecute=false requires assignee', async () => {
    const { project, agents } = setupProject()
    const [pm] = agents

    await expect(
      executeJson(
        'studio.task.createSimple',
        { title: 'Delegated task', description: 'Missing assignee', selfExecute: false },
        { projectId: project.id, agentId: pm.id, sessionId: 'sess-pm' },
      ),
    ).rejects.toThrow('assignee')
  })
})

describe('studio.task.create - draft collaboration shell', () => {
  test('creates a draft task without steps and ignores model-provided projectId', async () => {
    const { project, agents } = setupProject()
    const [pm] = agents

    const created = await executeJson(
      'studio.task.create',
      { title: '编排协作任务', description: '先设计再开发', projectId: 'proj-ignored' },
      { projectId: project.id, agentId: pm.id, sessionId: 'sess-pm' },
    )

    expect(created.taskId).toBeTruthy()
    expect(created.defaultStepId).toBeUndefined()
    expect(created.status).toBe('draft')

    const task = taskStore.get(created.taskId as string)!
    expect(task.status).toBe('draft')
    expect(task.project_id).toBe(project.id)
    expect(task.assigned_agent_id).toBeNull()
    expect(taskStepStore.listByTask(task.id)).toEqual([])
    expect(taskStore.listSessionIds(task.id)).toEqual([])
  })
})

describe('studio.task.create + step.add + task.start - 协作编排', () => {
  test('协作任务编排:多步骤 DAG,task.start 后派发 ready step', async () => {
    const { project, agents } = setupProject()
    const [pm, devA, devB, tester] = agents

    const created = await executeJson(
      'studio.task.create',
      { title: '实现登录重构', description: '需求文档' },
      { projectId: project.id, agentId: pm.id, sessionId: 'sess-pm' },
    )
    const taskId = created.taskId as string
    expect(taskStore.get(taskId)?.status).toBe('draft')

    const s1 = await executeJson(
      'studio.task.step.add',
      { taskId, title: '方案设计', description: '设计', assignee: pm.id },
      { projectId: project.id },
    )
    const s2 = await executeJson(
      'studio.task.step.add',
      { taskId, title: '后端开发', description: '后端', assignee: devA.id, dependsOn: [s1.stepId] },
      { projectId: project.id },
    )
    const s3 = await executeJson(
      'studio.task.step.add',
      { taskId, title: '前端开发', description: '前端', assignee: devB.id, dependsOn: [s1.stepId] },
      { projectId: project.id },
    )
    await executeJson(
      'studio.task.step.add',
      { taskId, title: '测试', description: '集成测试', assignee: tester.id, dependsOn: [s2.stepId, s3.stepId] },
      { projectId: project.id },
    )

    const stepsBefore = taskStepStore.listByTask(taskId)
    expect(stepsBefore).toHaveLength(4)
    expect(stepsBefore.every((s) => s.status === 'pending')).toBe(true)

    const started = await executeJson('studio.task.start', { taskId }, { projectId: project.id })
    expect(started.status).toBe('running')
    expect(started.dispatched).toContain(s1.stepId)

    expect(taskStepStore.get(s1.stepId as string)?.status).toBe('running')
    expect(taskStepStore.get(s2.stepId as string)?.status).toBe('pending')
    expect(taskStepStore.get(s3.stepId as string)?.status).toBe('pending')
  })
})

describe('report(done) 解锁下游 - 并行派发', () => {
  test('s1 done 后 s2 和 s3 都 ready 并被派发', async () => {
    const { project, agents } = setupProject()
    const [pm, devA, devB] = agents

    const task = createTaskRow('并行任务', project.id)
    const r1 = taskStepManager.addStep({ taskId: task.id, title: 's1', assignee: pm.id })
    const r2 = taskStepManager.addStep({ taskId: task.id, title: 's2', assignee: devA.id, dependsOn: [r1.step.id] })
    const r3 = taskStepManager.addStep({ taskId: task.id, title: 's3', assignee: devB.id, dependsOn: [r1.step.id] })
    taskStore.updateStatus(task.id, 'running', '已启动')
    taskStepStore.updateStatus(r1.step.id, 'ready')
    await taskStepManager.dispatchStep(task.id, r1.step.id)

    const result = await reportStepAndDispatch({
      taskId: task.id,
      stepId: r1.step.id,
      agentStatus: 'done',
      reportMd: 's1 done',
      agentId: pm.id,
    })

    expect(result.newStatus).toBe('done')
    expect(result.unlockedSteps.sort()).toEqual([r2.step.id, r3.step.id].sort())
    expect(result.dispatchedSteps.sort()).toEqual([r2.step.id, r3.step.id].sort())
    expect(taskStepStore.get(r2.step.id)?.status).toBe('running')
    expect(taskStepStore.get(r3.step.id)?.status).toBe('running')
  })

  test('studio.task.report with stepId done auto-dispatches unlocked downstream step', async () => {
    const { project, agents } = setupProject()
    const [pm, devA] = agents
    const { task, firstStep, nextStep } = await setupRunningTwoStepChain(project.id, pm.id, devA.id)

    const result = await executeJson(
      'studio.task.report',
      { taskId: task.id, stepId: firstStep.id, agentStatus: 'done', reportMd: 's1 done' },
      { projectId: project.id, agentId: pm.id },
    )

    expect(result.unlockedSteps).toEqual([nextStep.id])
    expect(result.dispatchedSteps).toEqual([nextStep.id])
    expect(taskStepStore.get(nextStep.id)?.status).toBe('running')
  })

  test('studio.task.report with stepId requires reportMd', async () => {
    const { project, agents } = setupProject()
    const [pm, devA] = agents
    const { task, firstStep } = await setupRunningTwoStepChain(project.id, pm.id, devA.id)
    const handler = getHandler('studio.task.report')!

    const result = await handler.execute(
      { taskId: task.id, stepId: firstStep.id, agentStatus: 'done' },
      { projectId: project.id, agentId: pm.id },
    )

    expectError(result, 'reportMd')
  })

  test('studio.task.step.report returns dispatched unlocked downstream step', async () => {
    const { project, agents } = setupProject()
    const [pm, devA] = agents
    const { task, firstStep, nextStep } = await setupRunningTwoStepChain(project.id, pm.id, devA.id)

    const result = await executeJson(
      'studio.task.step.report',
      { taskId: task.id, stepId: firstStep.id, agentStatus: 'done', reportMd: 's1 done' },
      { projectId: project.id, agentId: pm.id },
    )

    expect(result.unlockedSteps).toEqual([nextStep.id])
    expect(result.dispatchedSteps).toEqual([nextStep.id])
    expect(taskStepStore.get(nextStep.id)?.status).toBe('running')
  })

  test('tasks.step.report RPC auto-dispatches unlocked downstream step', async () => {
    const { project, agents } = setupProject()
    const [pm, devA] = agents
    const { task, firstStep, nextStep } = await setupRunningTwoStepChain(project.id, pm.id, devA.id)

    const result = (await callTaskRpc('tasks.step.report', {
      type: 'tasks.step.report',
      taskId: task.id,
      stepId: firstStep.id,
      agentStatus: 'done',
      reportMd: 's1 done',
    })) as Record<string, unknown>

    expect(result.unlockedSteps).toEqual([nextStep.id])
    expect(result.dispatchedSteps).toEqual([nextStep.id])
    expect(taskStepStore.get(nextStep.id)?.status).toBe('running')
  })

  test('task.start marks task needs_input and keeps step ready when dispatch validation fails', async () => {
    const { project } = setupProject()
    const otherProject = projectStore.create({ name: 'Other', workDir: resolve(tmp, 'other-project') })
    const otherAgent = agentStore.create({ name: 'OtherAgent', type: 'dev', runtime: 'mock', projectId: otherProject.id })
    const task = createTaskRow('派发失败', project.id)
    const step = taskStepManager.addStep({ taskId: task.id, title: 's1', assignee: otherAgent.id })

    const result = await taskStepManager.startTask(task.id)

    expect(result.task.status).toBe('needs_input')
    expect(result.dispatched).toEqual([])
    expect(taskStore.get(task.id)?.status).toBe('needs_input')
    expect(taskStepStore.get(step.step.id)?.status).toBe('ready')
  })

  test('s2+s3 全 done 后 s4(测试) ready', async () => {
    const { project, agents } = setupProject()
    const [pm, devA, devB, tester] = agents

    const task = createTaskRow('串行接力', project.id)
    const r1 = taskStepManager.addStep({ taskId: task.id, title: 's1', assignee: pm.id })
    const r2 = taskStepManager.addStep({ taskId: task.id, title: 's2', assignee: devA.id, dependsOn: [r1.step.id] })
    const r3 = taskStepManager.addStep({ taskId: task.id, title: 's3', assignee: devB.id, dependsOn: [r1.step.id] })
    const r4 = taskStepManager.addStep({
      taskId: task.id,
      title: 's4',
      assignee: tester.id,
      dependsOn: [r2.step.id, r3.step.id],
    })
    taskStore.updateStatus(task.id, 'running', '已启动')

    taskStepStore.updateStatus(r1.step.id, 'ready')
    await taskStepManager.dispatchStep(task.id, r1.step.id)
    taskStepManager.reportStep({
      taskId: task.id,
      stepId: r1.step.id,
      agentStatus: 'done',
      reportMd: 's1 done',
      agentId: pm.id,
    })

    expect(taskStepStore.get(r4.step.id)?.status).toBe('pending')

    taskStepStore.updateStatus(r2.step.id, 'ready')
    await taskStepManager.dispatchStep(task.id, r2.step.id)
    taskStepManager.reportStep({
      taskId: task.id,
      stepId: r2.step.id,
      agentStatus: 'done',
      reportMd: 's2 done',
      agentId: devA.id,
    })

    expect(taskStepStore.get(r4.step.id)?.status).toBe('pending')

    taskStepStore.updateStatus(r3.step.id, 'ready')
    await taskStepManager.dispatchStep(task.id, r3.step.id)
    const r3Report = taskStepManager.reportStep({
      taskId: task.id,
      stepId: r3.step.id,
      agentStatus: 'done',
      reportMd: 's3 done',
      agentId: devB.id,
    })

    expect(r3Report.unlockedSteps).toContain(r4.step.id)
    expect(taskStepStore.get(r4.step.id)?.status).toBe('ready')
  })
})

describe('运行中编辑步骤触发回退 draft', () => {
  test('running 任务 step.add 触发 task_reverted', async () => {
    const { project, agents } = setupProject()
    const [pm, devA] = agents

    const task = createTaskRow('动态追加', project.id)
    const r1 = taskStepManager.addStep({ taskId: task.id, title: 's1', assignee: devA.id })
    taskStore.updateStatus(task.id, 'running', '已启动')
    taskStepStore.updateStatus(r1.step.id, 'ready')
    await taskStepManager.dispatchStep(task.id, r1.step.id)

    expect(taskStore.get(task.id)?.status).toBe('running')

    const r2 = taskStepManager.addStep({ taskId: task.id, title: 's2', assignee: devA.id, dependsOn: [r1.step.id] })

    expect(r2.reverted).toBe(true)
    expect(taskStore.get(task.id)?.status).toBe('draft')

    const events = taskEventStore.list(task.id)
    expect(events.some((e) => e.type === 'task_reverted')).toBe(true)
  })

  test('draft 状态下 step.add 不触发回退(已经在 draft)', () => {
    const { project, agents } = setupProject()
    const [pm, devA] = agents

    const task = createTaskRow('draft 任务', project.id)
    const r1 = taskStepManager.addStep({ taskId: task.id, title: 's1', assignee: devA.id })

    expect(r1.reverted).toBe(false)
    expect(taskStore.get(task.id)?.status).toBe('draft')
  })

  test('step.update 触发回退', async () => {
    const { project, agents } = setupProject()
    const [pm, devA] = agents

    const task = createTaskRow('update 触发回退', project.id)
    const r1 = taskStepManager.addStep({ taskId: task.id, title: 's1', assignee: devA.id })
    taskStore.updateStatus(task.id, 'running', '已启动')
    taskStepStore.updateStatus(r1.step.id, 'ready')
    await taskStepManager.dispatchStep(task.id, r1.step.id)

    const result = taskStepManager.updateStep({
      taskId: task.id,
      stepId: r1.step.id,
      title: 's1 改名',
    })

    expect(result.reverted).toBe(true)
    expect(taskStore.get(task.id)?.status).toBe('draft')
  })

  test('step.remove 触发回退 + 通知取消会话', async () => {
    const { project, agents } = setupProject()
    const [pm, devA] = agents

    const task = createTaskRow('remove 触发回退', project.id)
    const r1 = taskStepManager.addStep({ taskId: task.id, title: 's1', assignee: devA.id })
    taskStore.updateStatus(task.id, 'running', '已启动')
    taskStepStore.updateStatus(r1.step.id, 'ready')
    const dispatched = await taskStepManager.dispatchStep(task.id, r1.step.id)
    const targetSessionId = dispatched.sessionId

    const origEnqueue = sessionManager.enqueuePrompt
    let notifiedSessionId: string | null = null
    sessionManager.enqueuePrompt = (async (sessionId: string) => {
      notifiedSessionId = sessionId
    }) as typeof sessionManager.enqueuePrompt
    try {
      const result = taskStepManager.removeStep({ taskId: task.id, stepId: r1.step.id })
      expect(result.reverted).toBe(true)
      expect(result.cancelledSessionId).toBe(targetSessionId)
      expect(notifiedSessionId).toBe(targetSessionId)
    } finally {
      sessionManager.enqueuePrompt = origEnqueue
    }
  })
})

describe('step.report(blocked) 通知发起人(v3)', () => {
  test('step blocked → 通知发起人(执行者≠发起人),任务保持 running', async () => {
    const { project, agents } = setupProject()
    const [pm, devA] = agents

    const task = taskStore.create({
      title: 'blocked 场景',
      description: 'test',
      source: 'agent',
      projectId: project.id,
      initiatorAgentId: pm.id,
      initiatorSessionId: 'sess-pm',
    })
    const r1 = taskStepManager.addStep({ taskId: task.id, title: 's1', assignee: devA.id })
    taskStore.updateStatus(task.id, 'running', '已启动')
    taskStepStore.updateStatus(r1.step.id, 'ready')
    await taskStepManager.dispatchStep(task.id, r1.step.id)

    const origEnqueue = sessionManager.enqueuePrompt
    let notifiedSessionId: string | null = null
    let notifiedText: string | null = null
    sessionManager.enqueuePrompt = (async (sessionId: string, prompt: string) => {
      if (sessionId === 'sess-pm') {
        notifiedSessionId = sessionId
        notifiedText = prompt
      }
    }) as typeof sessionManager.enqueuePrompt
    try {
      const blocked = taskStepManager.reportStep({
        taskId: task.id,
        stepId: r1.step.id,
        agentStatus: 'blocked',
        reportMd: '卡住需要决策',
        agentId: devA.id,
      })

      expect(blocked.newStatus).toBe('blocked')
      expect(taskStore.get(task.id)?.status).toBe('running')
      expect(notifiedSessionId).toBe('sess-pm')
      expect(notifiedText).toContain('步骤卡住')
    } finally {
      sessionManager.enqueuePrompt = origEnqueue
    }
  })

  test('step blocked → 执行者=发起人,不通知', async () => {
    const { project, agents } = setupProject()
    const [pm] = agents

    const task = taskStore.create({
      title: 'self blocked',
      description: 'test',
      source: 'agent',
      projectId: project.id,
      initiatorAgentId: pm.id,
      initiatorSessionId: 'sess-pm',
    })
    const r1 = taskStepManager.addStep({ taskId: task.id, title: 's1', assignee: pm.id })
    taskStore.updateStatus(task.id, 'running', '已启动')
    taskStepStore.updateStatus(r1.step.id, 'ready')
    await taskStepManager.dispatchStep(task.id, r1.step.id)

    const origEnqueue = sessionManager.enqueuePrompt
    let notifyCalled = false
    sessionManager.enqueuePrompt = (async (sessionId: string) => {
      if (sessionId === 'sess-pm') notifyCalled = true
    }) as typeof sessionManager.enqueuePrompt
    try {
      taskStepManager.reportStep({
        taskId: task.id,
        stepId: r1.step.id,
        agentStatus: 'blocked',
        reportMd: 'self 卡住',
        agentId: pm.id,
      })
      expect(notifyCalled).toBe(false)
    } finally {
      sessionManager.enqueuePrompt = origEnqueue
    }
  })
})

describe('所有 step done → 通知发起人(v3)', () => {
  test('最后执行者≠发起人 → 通知发起人拍板,任务不自动 completed', async () => {
    const { project, agents } = setupProject()
    const [pm, devA] = agents

    const task = taskStore.create({
      title: '完成场景',
      description: 'test',
      source: 'agent',
      projectId: project.id,
      initiatorAgentId: pm.id,
      initiatorSessionId: 'sess-pm',
    })
    const r1 = taskStepManager.addStep({ taskId: task.id, title: 's1', assignee: devA.id })
    const r2 = taskStepManager.addStep({ taskId: task.id, title: 's2', assignee: pm.id, dependsOn: [r1.step.id] })
    taskStore.updateStatus(task.id, 'running', '已启动')

    taskStepStore.updateStatus(r1.step.id, 'ready')
    await taskStepManager.dispatchStep(task.id, r1.step.id)
    taskStepManager.reportStep({
      taskId: task.id,
      stepId: r1.step.id,
      agentStatus: 'done',
      reportMd: 's1 done',
      agentId: devA.id,
    })

    taskStepStore.updateStatus(r2.step.id, 'ready')
    await taskStepManager.dispatchStep(task.id, r2.step.id)

    const origEnqueue = sessionManager.enqueuePrompt
    let notifiedSessionId: string | null = null
    let notifiedText: string | null = null
    sessionManager.enqueuePrompt = (async (sessionId: string, prompt: string) => {
      if (sessionId === 'sess-pm') {
        notifiedSessionId = sessionId
        notifiedText = prompt
      }
    }) as typeof sessionManager.enqueuePrompt
    try {
      taskStepManager.reportStep({
        taskId: task.id,
        stepId: r2.step.id,
        agentStatus: 'done',
        reportMd: 's2 done',
        agentId: pm.id,
      })
      // 最后执行者 = pm = 发起人 → 不通知
      expect(taskStore.get(task.id)?.status).toBe('running')
      expect(notifiedSessionId).toBe(null)
    } finally {
      sessionManager.enqueuePrompt = origEnqueue
    }
  })

  test('最后执行者≠发起人 → 通知发起人', async () => {
    const { project, agents } = setupProject()
    const [pm, devA, devB] = agents

    const task = taskStore.create({
      title: 'dev 做完通知 pm',
      description: 'test',
      source: 'agent',
      projectId: project.id,
      initiatorAgentId: pm.id,
      initiatorSessionId: 'sess-pm',
    })
    const r1 = taskStepManager.addStep({ taskId: task.id, title: 's1', assignee: devA.id })
    const r2 = taskStepManager.addStep({ taskId: task.id, title: 's2', assignee: devB.id, dependsOn: [r1.step.id] })
    taskStore.updateStatus(task.id, 'running', '已启动')

    taskStepStore.updateStatus(r1.step.id, 'ready')
    await taskStepManager.dispatchStep(task.id, r1.step.id)
    taskStepManager.reportStep({
      taskId: task.id,
      stepId: r1.step.id,
      agentStatus: 'done',
      reportMd: 's1 done',
      agentId: devA.id,
    })

    taskStepStore.updateStatus(r2.step.id, 'ready')
    await taskStepManager.dispatchStep(task.id, r2.step.id)

    const origEnqueue = sessionManager.enqueuePrompt
    let notifiedSessionId: string | null = null
    let notifiedText: string | null = null
    sessionManager.enqueuePrompt = (async (sessionId: string, prompt: string) => {
      if (sessionId === 'sess-pm') {
        notifiedSessionId = sessionId
        notifiedText = prompt
      }
    }) as typeof sessionManager.enqueuePrompt
    try {
      taskStepManager.reportStep({
        taskId: task.id,
        stepId: r2.step.id,
        agentStatus: 'done',
        reportMd: 's2 done',
        agentId: devB.id,
      })
      expect(notifiedSessionId).toBe('sess-pm')
      expect(notifiedText).toContain('所有步骤已完成')
      expect(taskStore.get(task.id)?.status).toBe('running')
    } finally {
      sessionManager.enqueuePrompt = origEnqueue
    }
  })
})

describe('循环依赖检测', () => {
  test('addStep 拒绝直接自循环(dependsOn 包含自己)', () => {
    const { project, agents } = setupProject()
    const [pm, devA] = agents
    const task = createTaskRow('循环检测', project.id)
    const r1 = taskStepManager.addStep({ taskId: task.id, title: 's1', assignee: devA.id })

    expect(() => {
      taskStepManager.updateStep({
        taskId: task.id,
        stepId: r1.step.id,
        dependsOn: [r1.step.id],
      })
    }).toThrow('不能依赖自己')
  })

  test('updateStep 拒绝形成环:A→B→A', () => {
    const { project, agents } = setupProject()
    const [pm, devA] = agents
    const task = createTaskRow('环检测', project.id)
    const r1 = taskStepManager.addStep({ taskId: task.id, title: 's1', assignee: devA.id })
    const r2 = taskStepManager.addStep({ taskId: task.id, title: 's2', assignee: devA.id, dependsOn: [r1.step.id] })

    expect(() => {
      taskStepManager.updateStep({
        taskId: task.id,
        stepId: r1.step.id,
        dependsOn: [r2.step.id],
      })
    }).toThrow('循环依赖')
  })

  test('detectCycle 三步链 A→B→C→A', () => {
    const { project, agents } = setupProject()
    const [pm, devA] = agents
    const task = createTaskRow('三步环', project.id)
    const r1 = taskStepManager.addStep({ taskId: task.id, title: 'A', assignee: devA.id })
    const r2 = taskStepManager.addStep({ taskId: task.id, title: 'B', assignee: devA.id, dependsOn: [r1.step.id] })
    const r3 = taskStepManager.addStep({ taskId: task.id, title: 'C', assignee: devA.id, dependsOn: [r2.step.id] })

    expect(detectCycle(task.id, r1.step.id, [r3.step.id])).toBe(true)
    expect(detectCycle(task.id, r1.step.id, [])).toBe(false)
  })
})

describe('buildStepPrompt - 防 Agent 失忆', () => {
  test('prompt 包含任务标题/描述/步骤图/我的步骤/上游产出', async () => {
    const { project, agents } = setupProject()
    const [pm, devA, devB] = agents

    const task = createTaskRow('防失忆任务', project.id)
    taskStore.update(task.id, { description: '任务目标文档 ABC' })
    const r1 = taskStepManager.addStep({
      taskId: task.id,
      title: '上游 step',
      description: '上游描述',
      assignee: devA.id,
    })
    const r2 = taskStepManager.addStep({
      taskId: task.id,
      title: '我的 step',
      description: '我的描述',
      assignee: devB.id,
      dependsOn: [r1.step.id],
    })
    taskStore.updateStatus(task.id, 'running', '已启动')

    taskStepStore.updateStatus(r1.step.id, 'ready')
    await taskStepManager.dispatchStep(task.id, r1.step.id)
    taskStepManager.reportStep({
      taskId: task.id,
      stepId: r1.step.id,
      agentStatus: 'done',
      reportMd: '上游已完成,产出 ABC',
      artifacts: [{ type: 'commit', value: 'abc123' }],
      agentId: devA.id,
    })

    taskStepStore.updateStatus(r2.step.id, 'ready')
    const prompt = buildStepPrompt(task.id, r2.step.id)

    expect(prompt).toContain(task.id)
    expect(prompt).toContain('任务目标文档 ABC')
    expect(prompt).toContain('上游 step')
    expect(prompt).toContain('我的 step')
    expect(prompt).toContain('你在这里')
    expect(prompt).toContain('上游产出摘要')
    expect(prompt).toContain('abc123')
    expect(prompt).toContain('task.step.updateProgress')
    expect(prompt).toContain('task.step.report')
  })
})

describe('studio.task.step.get 返回步骤历史汇报', () => {
  test('多次 report 后 step.get 返回完整历史', async () => {
    const { project, agents } = setupProject()
    const [pm, devA] = agents

    const task = createTaskRow('历史汇报', project.id)
    const r1 = taskStepManager.addStep({ taskId: task.id, title: 's1', assignee: devA.id })
    taskStore.updateStatus(task.id, 'running', '已启动')
    taskStepStore.updateStatus(r1.step.id, 'ready')
    await taskStepManager.dispatchStep(task.id, r1.step.id)

    taskStepManager.reportStep({
      taskId: task.id,
      stepId: r1.step.id,
      agentStatus: 'milestone',
      reportMd: '阶段 1',
      agentId: devA.id,
    })
    taskStepManager.reportStep({
      taskId: task.id,
      stepId: r1.step.id,
      agentStatus: 'milestone',
      reportMd: '阶段 2',
      agentId: devA.id,
    })
    taskStepManager.reportStep({
      taskId: task.id,
      stepId: r1.step.id,
      agentStatus: 'done',
      reportMd: '完成',
      artifacts: [{ type: 'commit', value: 'abc' }],
      agentId: devA.id,
    })

    const view = taskStepManager.buildStepView(task.id, r1.step.id)!
    expect(view.reports).toHaveLength(3)
    expect(view.reports[0].agentStatus).toBe('milestone')
    expect(view.reports[2].artifacts?.[0].value).toBe('abc')
  })
})

describe('老任务零改动兼容', () => {
  test('老任务 status 保留,studio.task.report 不传 stepId 走老逻辑', async () => {
    const { project, agents } = setupProject()
    const [pm] = agents

    const task = taskStore.create({ title: '老任务', source: 'human', projectId: project.id, assignAgentId: pm.id })
    taskStore.updateStatus(task.id, 'running', '已启动')

    const result = await executeJson(
      'studio.task.report',
      { taskId: task.id, agentStatus: 'milestone', reportMd: '老任务汇报' },
      { projectId: project.id, agentId: pm.id, sessionId: 'sess-old' },
    )

    expect(result.status).toBeTruthy()
    const updated = taskStore.get(task.id)!
    expect(['running', 'needs_input']).toContain(updated.status)
  })

  test('studio.task.get 老任务返回 steps 空数组', async () => {
    const { project, agents } = setupProject()
    const [pm] = agents

    const task = taskStore.create({ title: '老任务', source: 'human', projectId: project.id })

    const result = await executeJson('studio.task.get', { taskId: task.id }, { projectId: project.id })

    expect(result.steps).toEqual([])
  })
})

describe('task.start 幂等 + 重新评估', () => {
  test('running 状态下 task.start 幂等,不报错', async () => {
    const { project, agents } = setupProject()
    const [pm, devA] = agents

    const task = createTaskRow('幂等', project.id)
    const r1 = taskStepManager.addStep({ taskId: task.id, title: 's1', assignee: devA.id })
    taskStore.updateStatus(task.id, 'running', '已启动')
    taskStepStore.updateStatus(r1.step.id, 'ready')
    await taskStepManager.dispatchStep(task.id, r1.step.id)

    const result = await taskStepManager.startTask(task.id)
    expect(result.task.status).toBe('running')
  })

  test('completed 状态下 task.start 报错', async () => {
    const { project, agents } = setupProject()
    const [pm] = agents

    const task = createTaskRow('已完成', project.id)
    taskStore.updateStatus(task.id, 'completed', '已完成')

    await expect(taskStepManager.startTask(task.id)).rejects.toThrow('已完成')
  })
})

describe('project access 隔离', () => {
  test('跨项目访问步骤被拒', async () => {
    const { project, agents } = setupProject()
    const [pm] = agents
    const otherProject = projectStore.create({ name: 'Other', workDir: resolve(tmp, 'other') })

    const task = createTaskRow('P 任务', project.id)
    const r1 = taskStepManager.addStep({ taskId: task.id, title: 's1', assignee: pm.id })

    const handler = getHandler('studio.task.step.get')!
    const result = await handler.execute({ taskId: task.id, stepId: r1.step.id }, { projectId: otherProject.id })
    expectError(result, '权限不足')
  })
})
