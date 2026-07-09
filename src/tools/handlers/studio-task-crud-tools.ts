import type { ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'
import { taskStore } from '../../store/tasks.js'
import { sessionStore } from '../../store/sessions.js'
import { taskStepStore } from '../../store/task-steps.js'
import { emitTaskLifecycleEvent, resolveSessionMode, taskManager } from '../../core/tasks.js'
import { taskStepManager } from '../../core/task-steps.js'
import { events } from '../../core/events.js'
import { createChildLogger } from '../../core/logger.js'

const log = createChildLogger('studio-task-tools')

export function requireStr(input: ToolHandlerInput, key: string): string {
  const v = input[key]
  if (typeof v !== 'string' || !v.trim()) throw new Error(`参数 ${key} 不能为空`)
  return v.trim()
}

export function optStr(input: ToolHandlerInput, key: string): string | undefined {
  const v = input[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

export function errResult(msg: string): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true }
}

export function assertProjectAccess(task: { project_id: string | null }, contextProjectId: string | undefined): void {
  if (contextProjectId && task.project_id && task.project_id !== contextProjectId) {
    throw new Error('权限不足：该任务不属于当前项目')
  }
}

export const studioTaskCreateHandler: ToolHandler = {
  name: 'studio.task.create',
  description: `创建协作任务容器(仅建空壳,后续 step.add 编排 + task.start 启动)。
- 协作任务用此工具,创建后 draft 状态,需 task.step.add 编排 + task.start 启动
- 不含任何步骤,步骤一律通过 task.step.add 单独加
- 简单任务(单 Agent 一步完成)用 studio.task.createSimple,不要用这个
- selfExecute=true 时,自己认领并在当前会话开始执行(对话任务化),不会创建草稿容器`,
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '任务标题' },
      description: { type: 'string', description: '任务目标文档(背景/需求/验收标准)' },
      selfExecute: { type: 'boolean', description: '自己认领并立即在当前会话开始执行(对话任务化)' },
      assignAgentId: { type: 'string', description: '指派 Agent(selfExecute=true 时忽略此参数)' },
      sessionMode: { type: 'string', enum: ['existing', 'new_each', 'new_fixed'] },
      sessionId: { type: 'string' },
      executionModeId: { type: 'string' },
      projectId: { type: 'string' },
    },
    required: ['title'],
  },
  async execute(input, context) {
    const title = requireStr(input, 'title')
    const selfExecute = input.selfExecute === true

    let assignAgentId = optStr(input, 'assignAgentId')
    let sessionId = optStr(input, 'sessionId')
    let sessionMode = resolveSessionMode(input.sessionMode, sessionId)

    if (selfExecute) {
      if (!context?.agentId) throw new Error('selfExecute=true 需要在 Agent 会话上下文中使用')
      if (!context?.sessionId) throw new Error('selfExecute=true 需要在当前会话中使用')
      assignAgentId = context.agentId
      sessionId = context.sessionId
      sessionMode = 'existing'
    }

    const task = await taskManager.createTask({
      title,
      description: optStr(input, 'description'),
      source: 'agent',
      assignAgentId,
      sessionId,
      sessionMode,
      projectId: context?.projectId ?? optStr(input, 'projectId'),
      executionModeId: optStr(input, 'executionModeId'),
      selfExecute,
    })
    if (!task) throw new Error('任务创建失败')
    log.info({ taskId: task.id, title, selfExecute }, 'Agent 创建任务')
    return {
      content: [{ type: 'text', text: JSON.stringify({ taskId: task.id, title: task.title, status: task.status, sessionId: (task as Record<string, unknown>).sessionId }, null, 2) }],
    }
  },
}

export const studioTaskCreateSimpleHandler: ToolHandler = {
  name: 'studio.task.createSimple',
  description: `创建简单任务(单 Agent 一步完成),自动建默认 step + 自动 start,立即派发。
- 单 Agent 一步完成的任务用这个,create 即派发,不用手动 start
- 内部等价于:task.create + task.step.add(assignee) + task.start,但一步原子完成
- 创建后 status=running,默认 step 已派给 assignee
- Agent 调 task.step.report(defaultStepId, done) 后任务 completed
- ⚠️ 如果任务需要多步骤/多 Agent 协作,用 studio.task.create,不要用这个`,
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '任务标题' },
      description: { type: 'string', description: '任务目标文档' },
      assignee: { type: 'string', description: '分派给哪个 Agent' },
      sessionId: { type: 'string', description: '可选,指定会话(不传系统按 assignee 找 primary 会话)' },
      projectId: { type: 'string' },
    },
    required: ['title', 'assignee'],
  },
  async execute(input, context) {
    const title = requireStr(input, 'title')
    const assignee = requireStr(input, 'assignee')
    const description = optStr(input, 'description')
    const sessionId = optStr(input, 'sessionId')
    const projectId = context?.projectId ?? optStr(input, 'projectId')

    const task = taskStore.create({
      title,
      description,
      source: 'agent',
      projectId,
    })
    events.emit('task:update', { taskId: task.id, data: { ...task, event: 'created' } })
    emitTaskLifecycleEvent(task, 'created', null)

    const { step } = taskStepManager.addStep({
      taskId: task.id,
      title,
      description,
      assignee,
      sessionId,
    })
    taskStore.updateStatus(task.id, 'running', '简单任务已启动')
    taskStepStore.updateStatus(step.id, 'ready')

    try {
      await taskStepManager.dispatchStep(task.id, step.id)
    } catch (err) {
      log.warn({ err, taskId: task.id, stepId: step.id }, 'createSimple dispatch failed')
      throw err
    }

    log.info({ taskId: task.id, stepId: step.id, assignee }, '简单任务已创建并派发')
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          taskId: task.id,
          defaultStepId: step.id,
          status: 'running',
          assignee,
        }, null, 2),
      }],
    }
  },
}

export const studioTaskListHandler: ToolHandler = {
  name: 'studio.task.list',
  description: '查看当前 AI IDE Studio 项目中的任务列表。可按状态过滤。',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '项目 ID（不传用当前会话项目）' },
      status: { type: 'string', description: '按状态过滤:draft/running/needs_input/completed/cancelled' },
    },
  },
  async execute(input, context) {
    const projectId = context?.projectId ?? optStr(input, 'projectId')
    if (!projectId) return errResult('projectId 不能为空')
    const status = optStr(input, 'status')
    const tasks = taskStore.list(status, projectId)
    const summary = tasks.map(t => ({
      id: t.id, title: t.title, status: t.status, stage: t.stage,
      source: t.source, assignedAgentId: t.assigned_agent_id, createdAt: t.created_at,
    }))
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] }
  },
}

export const studioTaskGetHandler: ToolHandler = {
  name: 'studio.task.get',
  description: '取任务全貌(步骤只返回标题+状态,不展开报告)。',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 ID' },
    },
    required: ['taskId'],
  },
  async execute(input, context) {
    const taskId = requireStr(input, 'taskId')
    const task = taskStore.get(taskId)
    if (!task) return errResult('任务不存在')
    try { assertProjectAccess(task, context?.projectId) } catch (e) { return errResult((e as Error).message) }
    const sessions = sessionStore.listByTask(taskId).map(s => ({ id: s.id, agentId: s.agent_id, status: s.status, startedAt: s.started_at }))
    const steps = taskStepStore.listByTask(taskId).map(s => ({
      id: s.id,
      title: s.title,
      status: s.status,
      assignee: s.assignee_agent_id,
      dependsOn: taskStepStore.listDependencies(s.id),
    }))
    const assignedAgents = taskStepStore.listAssignedAgents(taskId)
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ...task,
          steps,
          assignedAgents,
          sessions,
        }, null, 2),
      }],
    }
  },
}

export const studioTaskUpdateHandler: ToolHandler = {
  name: 'studio.task.update',
  description: '修改任务标题或目标文档。不会触发回 draft(只改任务级字段,不动 steps)。',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 ID' },
      title: { type: 'string', description: '任务标题' },
      description: { type: 'string', description: '任务目标文档' },
    },
    required: ['taskId'],
  },
  async execute(input, context) {
    const taskId = requireStr(input, 'taskId')
    const task = taskStore.get(taskId)
    if (!task) return errResult('任务不存在')
    try { assertProjectAccess(task, context?.projectId) } catch (e) { return errResult((e as Error).message) }
    const title = optStr(input, 'title')
    const description = optStr(input, 'description')
    const updated = taskStore.update(taskId, {
      title: title ?? undefined,
      description: description !== undefined ? description : undefined,
    })
    if (updated) {
      events.emit('task:update', { taskId, data: { ...updated, event: 'updated' } })
      emitTaskLifecycleEvent(updated, 'progress_updated', task.status)
    }
    return { content: [{ type: 'text', text: JSON.stringify({ taskId, title: updated?.title, status: updated?.status }, null, 2) }] }
  },
}
