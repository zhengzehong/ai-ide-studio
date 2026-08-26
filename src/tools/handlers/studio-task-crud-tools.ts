import type { ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'
import { taskStore } from '../../store/tasks.js'
import { sessionStore } from '../../store/sessions.js'
import { taskStepStore } from '../../store/task-steps.js'
import { emitTaskLifecycleEvent, taskManager } from '../../core/tasks.js'
import { createSimpleTask } from '../../core/task-simple.js'
import { events } from '../../core/events.js'
import { createChildLogger } from '../../core/logger.js'
import { InvalidTaskCursorError, listTaskPageRows } from '../../store/task-page.js'

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
    '创建且仅创建一个默认步骤。selfExecute=true 表示当前对话已经在执行该默认步骤，因此只跳过这一次初始 Prompt；它不代表后续新增步骤会免 Prompt 或持续后台执行。多步骤任务请使用 studio.task.create + step.add + task.start。',
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
  description: '分页查看当前项目任务。默认返回 200 条精简摘要；同一问题通常只调用一次，优先用 query 查标题或任务 ID，仅在目标未找到且 hasMore=true 时传 nextCursor 继续。',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', description: '按状态过滤:draft/running/needs_input/completed/cancelled' },
      query: { type: 'string', description: '按任务标题或任务 ID 关键词查找' },
      limit: { type: 'number', default: 200, maximum: 200, description: '返回条数，默认和最大均为 200' },
      cursor: { type: 'string', description: '上一页返回的 nextCursor；没有时不要传' },
    },
  },
  async execute(input, context) {
    const projectId = context?.projectId
    if (!projectId) return errResult('projectId 不能为空')
    const limit = boundedToolLimit(input.limit)
    try {
      const page = listTaskPageRows({
        projectId,
        status: optStr(input, 'status'),
        query: optStr(input, 'query'),
        cursor: optStr(input, 'cursor'),
        limit,
      })
      const hasMore = page.items.length > limit
      const rows = hasMore ? page.items.slice(0, limit) : page.items
      const tasks = rows.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        stage: task.stage,
        source: task.source,
        assignedAgentId: task.assigned_agent_id,
        createdAt: task.created_at,
      }))
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            tasks,
            total: page.total,
            hasMore,
            nextCursor: hasMore ? (rows.at(-1)?.id ?? null) : null,
          }, null, 2),
        }],
      }
    } catch (error) {
      if (error instanceof InvalidTaskCursorError) return errResult('cursor 已失效，请不传 cursor 重新查询')
      throw error
    }
  },
}

function boundedToolLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 200
  return Math.min(200, Math.max(1, Math.floor(value)))
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
      sessionId: s.session_id,
      currentStage: s.current_stage,
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
              defaultExecutionSessionId: task.assigned_agent_id
                ? taskStore.getExecutionSessionId(taskId, task.assigned_agent_id) ?? null
                : null,
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
