import type { ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'
import { taskStore } from '../../store/tasks.js'
import { sessionStore } from '../../store/sessions.js'
import { resolveSessionMode, taskManager } from '../../core/tasks.js'
import { events } from '../../core/events.js'
import { createChildLogger } from '../../core/logger.js'

const log = createChildLogger('studio-task-tools')

function requireStr(input: ToolHandlerInput, key: string): string {
  const v = input[key]
  if (typeof v !== 'string' || !v.trim()) throw new Error(`参数 ${key} 不能为空`)
  return v.trim()
}

function optStr(input: ToolHandlerInput, key: string): string | undefined {
  const v = input[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function errResult(msg: string): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true }
}

function assertProjectAccess(task: { project_id: string | null }, contextProjectId: string | undefined): void {
  if (contextProjectId && task.project_id && task.project_id !== contextProjectId) {
    throw new Error('权限不足：该任务不属于当前项目')
  }
}

export const studioTaskCreateHandler: ToolHandler = {
  name: 'studio.task.create',
  description: '在 AI IDE Studio 项目中创建一个新任务。这是平台级任务管理，用于追踪需要完成的工作项。指派 Agent 后会自动发送任务指派消息。',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '任务标题' },
      description: { type: 'string', description: '任务描述' },
      assignAgentId: { type: 'string', description: '指派 Agent（可选）' },
      sessionMode: { type: 'string', enum: ['existing', 'new_each', 'new_fixed'], description: '会话策略：existing=指定已有会话，new_each=新建会话，new_fixed=固定新会话' },
      sessionId: { type: 'string', description: '复用已有会话 ID（可选，不传则新建）' },
      projectId: { type: 'string', description: '项目 ID（不传用当前会话项目）' },
    },
    required: ['title'],
  },
  async execute(input, context) {
    const title = requireStr(input, 'title')
    const task = await taskManager.createTask({
      title,
      description: optStr(input, 'description'),
      source: 'agent',
      assignAgentId: optStr(input, 'assignAgentId'),
      sessionId: optStr(input, 'sessionId'),
      sessionMode: resolveSessionMode(input.sessionMode, optStr(input, 'sessionId')),
      projectId: context?.projectId ?? optStr(input, 'projectId'),
    })
    log.info({ taskId: task.id, title }, 'Agent 创建任务')
    return {
      content: [{ type: 'text', text: JSON.stringify({ taskId: task.id, title: task.title, status: task.status, sessionId: (task as Record<string, unknown>).sessionId }, null, 2) }],
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
      status: { type: 'string', description: '按状态过滤：backlog/executing/needs_input/blocked/reviewing/completed/cancelled' },
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
  description: '获取 AI IDE Studio 项目中单个任务的完整详情。',
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
    return { content: [{ type: 'text', text: JSON.stringify({ ...task, sessions }, null, 2) }] }
  },
}

export const studioTaskUpdateProgressHandler: ToolHandler = {
  name: 'studio.task.update_progress',
  description: '更新你当前正在执行的 AI IDE Studio 项目任务的进度。每完成一个阶段都应该调用此工具让用户了解进展。当从待确认或阻塞状态恢复时也用此工具。',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 ID' },
      stage: { type: 'string', description: '当前阶段描述' },
    },
    required: ['taskId', 'stage'],
  },
  async execute(input, context) {
    const taskId = requireStr(input, 'taskId')
    const stage = requireStr(input, 'stage')
    const task = taskStore.get(taskId)
    if (!task) return errResult('任务不存在')
    try { assertProjectAccess(task, context?.projectId) } catch (e) { return errResult((e as Error).message) }

    const shouldRecover = task.status === 'needs_input' || task.status === 'blocked'
    const newStatus = shouldRecover ? 'executing' : task.status
    taskStore.updateStatus(taskId, newStatus, stage)

    log.info({ taskId, stage, recovered: shouldRecover }, 'Agent 更新进度')
    events.emit('task:update', {
      taskId,
      data: { ...taskStore.get(taskId), event: 'progress_updated' },
    })

    return { content: [{ type: 'text', text: JSON.stringify({ taskId, status: newStatus, stage }) }] }
  },
}

export const studioTaskRequestInputHandler: ToolHandler = {
  name: 'studio.task.request_input',
  description: '当你在执行 AI IDE Studio 项目任务时，遇到需要人工决策或确认的分支，调用此工具。用户会在任务面板中看到你的问题。',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 ID' },
      question: { type: 'string', description: '需要人工确认的问题' },
    },
    required: ['taskId', 'question'],
  },
  async execute(input, context) {
    const taskId = requireStr(input, 'taskId')
    const question = requireStr(input, 'question')
    const task = taskStore.get(taskId)
    if (!task) return errResult('任务不存在')
    try { assertProjectAccess(task, context?.projectId) } catch (e) { return errResult((e as Error).message) }

    taskStore.updateStatus(taskId, 'needs_input', question)
    log.info({ taskId, question }, 'Agent 请求输入')
    events.emit('task:update', {
      taskId,
      data: { ...taskStore.get(taskId), event: 'input_requested' },
    })

    return { content: [{ type: 'text', text: JSON.stringify({ taskId, status: 'needs_input' }) }] }
  },
}

export const studioTaskMarkBlockedHandler: ToolHandler = {
  name: 'studio.task.mark_blocked',
  description: '当你在执行 AI IDE Studio 项目任务时，遇到自己无法解决的问题（如缺少权限、缺少依赖、需要外部操作），调用此工具上报阻塞。',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 ID' },
      reason: { type: 'string', description: '阻塞原因' },
    },
    required: ['taskId', 'reason'],
  },
  async execute(input, context) {
    const taskId = requireStr(input, 'taskId')
    const reason = requireStr(input, 'reason')
    const task = taskStore.get(taskId)
    if (!task) return errResult('任务不存在')
    try { assertProjectAccess(task, context?.projectId) } catch (e) { return errResult((e as Error).message) }

    taskStore.updateStatus(taskId, 'blocked', reason)
    log.info({ taskId, reason }, 'Agent 标记阻塞')
    events.emit('task:update', {
      taskId,
      data: { ...taskStore.get(taskId), event: 'marked_blocked' },
    })

    return { content: [{ type: 'text', text: JSON.stringify({ taskId, status: 'blocked' }) }] }
  },
}

export const studioTaskMarkDoneHandler: ToolHandler = {
  name: 'studio.task.mark_done',
  description: '当你认为 AI IDE Studio 项目任务已经完成，调用此工具通知用户进行审查。请在 summary 中说明你完成了什么。',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 ID' },
      summary: { type: 'string', description: '完成总结' },
    },
    required: ['taskId'],
  },
  async execute(input, context) {
    const taskId = requireStr(input, 'taskId')
    const summary = optStr(input, 'summary') || 'Agent 已完成，等待人工确认'
    const task = taskStore.get(taskId)
    if (!task) return errResult('任务不存在')
    try { assertProjectAccess(task, context?.projectId) } catch (e) { return errResult((e as Error).message) }

    taskStore.updateStatus(taskId, 'reviewing', summary)
    log.info({ taskId, summary }, 'Agent 标记完成')
    events.emit('task:update', {
      taskId,
      data: { ...taskStore.get(taskId), event: 'marked_done' },
    })

    return { content: [{ type: 'text', text: JSON.stringify({ taskId, status: 'reviewing' }) }] }
  },
}
