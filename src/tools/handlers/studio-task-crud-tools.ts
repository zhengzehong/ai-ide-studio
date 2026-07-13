import type { ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'
import { taskStore } from '../../store/tasks.js'
import { sessionStore } from '../../store/sessions.js'
import { taskStepStore } from '../../store/task-steps.js'
import { emitTaskLifecycleEvent, taskManager } from '../../core/tasks.js'
import { createSimpleTask } from '../../core/task-simple.js'
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
  description: '创建协作任务空壳。仅建空壳,后续 step.add 编排 + task.start 启动。用于多 Agent 协作编排。',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '任务标题' },
      description: { type: 'string', description: '任务目标文档(背景/需求/验收标准)' },
    },
    required: ['title', 'description'],
  },
  async execute(input, context) {
    const title = requireStr(input, 'title')
    const description = requireStr(input, 'description')

    const task = await taskManager.createTask({
      title,
      description,
      source: 'agent',
      projectId: context.projectId,
      initiatorAgentId: context.agentId,
      initiatorSessionId: context.sessionId,
    })
    if (!task) throw new Error('任务创建失败')
    log.info({ taskId: task.id, title }, 'Agent 创建协作任务空壳')
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              taskId: task.id,
              title: task.title,
              status: task.status,
            },
            null,
            2,
          ),
        },
      ],
    }
  },
}

export const studioTaskCreateSimpleHandler: ToolHandler = {
  name: 'studio.task.createSimple',
  description:
    '创建一步任务。两种模式:selfExecute=true(对话任务化,自做) / selfExecute=false(派发给别人)。自动建默认 step + 自动 start。',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '任务标题' },
      description: { type: 'string', description: '任务目标文档' },
      selfExecute: { type: 'boolean', default: false, description: 'true=对话任务化(自做);false=派发给别人' },
      assignee: { type: 'string', description: 'selfExecute=false 时必填;selfExecute=true 时忽略' },
      sessionId: { type: 'string', description: 'selfExecute=false 时可指定会话;selfExecute=true 时忽略' },
    },
    required: ['title', 'description'],
  },
  async execute(input, context) {
    const title = requireStr(input, 'title')
    const description = requireStr(input, 'description')
    const selfExecute = input.selfExecute === true
    if (selfExecute && !context.agentId) throw new Error('selfExecute=true 需要在 Agent 会话上下文中使用')
    if (selfExecute && !context.sessionId) throw new Error('selfExecute=true 需要在当前会话中使用')
    const assignee = selfExecute ? undefined : requireStr(input, 'assignee')
    const sessionId = selfExecute ? undefined : optStr(input, 'sessionId')

    const result = await createSimpleTask({
      title,
      description,
      source: 'agent',
      projectId: context.projectId,
      selfExecute,
      assignee,
      sessionId,
      currentAgentId: context.agentId,
      currentSessionId: context.sessionId,
    })

    const effectiveAssignee = selfExecute ? context.agentId : assignee
    log.info(
      { taskId: result.task.id, stepId: result.defaultStepId, assignee: effectiveAssignee, selfExecute },
      'Agent 创建一步任务',
    )
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              taskId: result.task.id,
              defaultStepId: result.defaultStepId,
              status: 'running',
              assignee: effectiveAssignee,
              sessionId: result.sessionId,
            },
            null,
            2,
          ),
        },
      ],
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
    const summary = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      stage: t.stage,
      source: t.source,
      assignedAgentId: t.assigned_agent_id,
      createdAt: t.created_at,
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
    try {
      assertProjectAccess(task, context?.projectId)
    } catch (e) {
      return errResult((e as Error).message)
    }
    const sessions = sessionStore
      .listByTask(taskId)
      .map((s) => ({ id: s.id, agentId: s.agent_id, status: s.status, startedAt: s.started_at }))
    const steps = taskStepStore.listByTask(taskId).map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      assignee: s.assignee_agent_id,
      dependsOn: taskStepStore.listDependencies(s.id),
    }))
    const assignedAgents = taskStepStore.listAssignedAgents(taskId)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ...task,
              steps,
              assignedAgents,
              sessions,
            },
            null,
            2,
          ),
        },
      ],
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
    try {
      assertProjectAccess(task, context?.projectId)
    } catch (e) {
      return errResult((e as Error).message)
    }
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
    return {
      content: [
        { type: 'text', text: JSON.stringify({ taskId, title: updated?.title, status: updated?.status }, null, 2) },
      ],
    }
  },
}
