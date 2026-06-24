import type { ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'
import { taskStore } from '../../store/tasks.js'
import { sessionStore } from '../../store/sessions.js'
import { emitTaskLifecycleEvent, resolveSessionMode, taskManager } from '../../core/tasks.js'
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

export const studioTaskAssignHandler: ToolHandler = {
  name: 'studio.task.assign',
  description: '将一个未分派的 AI IDE Studio 项目任务分派给指定 Agent。默认不允许改派，除非显式传入 allowReassign=true。',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 ID' },
      agentId: { type: 'string', description: '目标 Agent ID' },
      sessionMode: { type: 'string', enum: ['existing', 'new_each', 'new_fixed'], description: '会话策略' },
      sessionId: { type: 'string', description: '复用已有会话 ID' },
      reason: { type: 'string', description: '分派原因' },
      allowReassign: { type: 'boolean', description: '是否允许改派已分派任务' },
    },
    required: ['taskId', 'agentId'],
  },
  async execute(input, context) {
    const taskId = requireStr(input, 'taskId')
    const agentId = requireStr(input, 'agentId')
    const task = taskStore.get(taskId)
    if (!task) return errResult('任务不存在')
    try { assertProjectAccess(task, context?.projectId) } catch (e) { return errResult((e as Error).message) }
    if (task.assigned_agent_id && input.allowReassign !== true) {
      return errResult('任务已分派，如需改派请传 allowReassign=true')
    }

    let assigned: Awaited<ReturnType<typeof taskManager.assignTask>>
    try {
      assigned = await taskManager.assignTask({
        taskId,
        agentId,
        sessionId: optStr(input, 'sessionId'),
        sessionMode: resolveSessionMode(input.sessionMode, optStr(input, 'sessionId')),
      })
    } catch (e) {
      return errResult((e as Error).message)
    }
    log.info({ taskId, agentId, reason: optStr(input, 'reason') }, 'Agent 分派任务')
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ task: assigned, sessionId: assigned.sessionId, reason: optStr(input, 'reason') }, null, 2),
      }],
    }
  },
}

export const studioTaskUpdateProgressHandler: ToolHandler = {
  name: 'studio.task.update_progress',
  description: '更新你当前正在执行的 AI IDE Studio 项目任务的进度（轻量，仅更新阶段描述）。每完成一个小步骤都调用此工具。当任务处于「待确认」状态时调用此工具会自动恢复为「行动中」。',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 ID' },
      stage: { type: 'string', description: '当前阶段描述（一句话）' },
    },
    required: ['taskId', 'stage'],
  },
  async execute(input, context) {
    const taskId = requireStr(input, 'taskId')
    const stage = requireStr(input, 'stage')
    const task = taskStore.get(taskId)
    if (!task) return errResult('任务不存在')
    try { assertProjectAccess(task, context?.projectId) } catch (e) { return errResult((e as Error).message) }

    const shouldRecover = task.status === 'needs_input'
    const newStatus = shouldRecover ? 'executing' : task.status
    taskStore.updateStatus(taskId, newStatus, stage)
    if (shouldRecover) taskStore.updateAgentReportStatus(taskId, 'in_progress')
    emitTaskLifecycleEvent(taskStore.get(taskId)!, shouldRecover ? 'status_changed' : 'progress_updated', task.status)

    log.info({ taskId, stage, recovered: shouldRecover }, 'Agent 更新进度')
    events.emit('task:update', {
      taskId,
      data: { ...taskStore.get(taskId), event: 'progress_updated' },
    })

    return { content: [{ type: 'text', text: JSON.stringify({ taskId, status: newStatus, stage }) }] }
  },
}

export const studioTaskReportHandler: ToolHandler = {
  name: 'studio.task.report',
  description: '关键节点汇报：带 Markdown 报告向用户同步进展，并更新你的自我评估状态（agentStatus）。任务状态会根据 agentStatus 自动推导：in_progress 保持/恢复行动中；blocked 和 done 都会让任务进入「待确认」等待人工处理。',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 ID' },
      agentStatus: { type: 'string', enum: ['in_progress', 'blocked', 'done'], description: '你的自我评估状态：in_progress=正在执行；blocked=遇到问题需要人工决策；done=本轮完成等待验收' },
      reportMd: { type: 'string', description: 'Markdown 报告，建议结构：## 本轮工作 / ## 下一步计划 / ## 问题或总结' },
      stage: { type: 'string', description: '当前阶段描述（可选，一句话）' },
    },
    required: ['taskId', 'agentStatus'],
  },
  async execute(input, context) {
    const taskId = requireStr(input, 'taskId')
    const agentStatus = requireStr(input, 'agentStatus')
    if (agentStatus !== 'in_progress' && agentStatus !== 'blocked' && agentStatus !== 'done') {
      return errResult('agentStatus 必须是 in_progress / blocked / done 之一')
    }
    const reportMd = optStr(input, 'reportMd')
    const stage = optStr(input, 'stage')
    const task = taskStore.get(taskId)
    if (!task) return errResult('任务不存在')
    try { assertProjectAccess(task, context?.projectId) } catch (e) { return errResult((e as Error).message) }

    try {
      const updated = taskManager.reportTask({ taskId, agentStatus, reportMd, stage })
      return { content: [{ type: 'text', text: JSON.stringify({ taskId, status: updated.status, agentReportStatus: updated.agent_report_status }) }] }
    } catch (e) {
      return errResult((e as Error).message)
    }
  },
}

