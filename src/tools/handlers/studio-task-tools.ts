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
  description: `在 AI IDE Studio 项目中创建任务。两种模式:
- selfExecute=true(对话任务化,常用):自己认领并立即在当前会话开始执行。用于用户在当前对话中布置的实质任务——写代码、修 bug、调研、重构等多步骤工作。不创建新会话,不发任务指派 prompt,创建后任务直接进入"执行中"。识别信号:用户说"帮我..."、"修复..."、"重构..."、"调研..."等,且工作需要多步完成。不要用于:简单问答、单次解释、闲聊、一句话能答完的问题。
- selfExecute=false(默认):创建任务并可指派给其他 Agent,会发送任务指派 prompt 到目标会话。跨 Agent 分派用此模式。`,
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '任务标题' },
      description: { type: 'string', description: '任务描述' },
      selfExecute: { type: 'boolean', description: '自己认领并立即在当前会话开始执行。true 时强制使用当前 Agent + 当前会话,不创建新会话,不发送任务指派 prompt(用户消息本身就是任务上下文)。默认 false。' },
      assignAgentId: { type: 'string', description: '指派 Agent(selfExecute=true 时忽略此参数;selfExecute=false 且不传时任务进入待办)' },
      sessionMode: { type: 'string', enum: ['existing', 'new_each', 'new_fixed'], description: '会话策略:selfExecute=true 时忽略此参数' },
      sessionId: { type: 'string', description: '复用的会话 ID:selfExecute=true 时忽略此参数' },
      executionModeId: { type: 'string', description: '执行模式 ID,决定 prompt 模板和报告模板' },
      projectId: { type: 'string', description: '项目 ID(不传用当前会话项目)' },
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

export const studioTaskListHandler: ToolHandler = {
  name: 'studio.task.list',
  description: '查看当前 AI IDE Studio 项目中的任务列表。可按状态过滤。',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '项目 ID（不传用当前会话项目）' },
      status: { type: 'string', description: '按状态过滤：backlog/executing/needs_input/completed/cancelled' },
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
  description: '关键节点汇报：带 Markdown 报告向用户同步进展，并更新自我评估状态（agentStatus）。任务状态会根据 agentStatus 自动推导：milestone 保持/恢复行动中（Agent 继续工作）；blocked 和 done 都会让任务进入「待确认」等待人工处理。',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 ID' },
      agentStatus: { type: 'string', enum: ['milestone', 'blocked', 'done'], description: '自我评估状态：milestone=中间步骤完成（阶段性成果，任务保持行动中，继续执行）；blocked=遇到问题需要人工决策；done=本轮完成等待验收' },
      reportMd: { type: 'string', description: 'Markdown 报告，按当前执行模式要求填写，参考任务指派 prompt 中的模板' },
      stage: { type: 'string', description: '当前阶段描述（可选，一句话）' },
    },
    required: ['taskId', 'agentStatus'],
  },
  async execute(input, context) {
    const taskId = requireStr(input, 'taskId')
    const agentStatus = requireStr(input, 'agentStatus')
    if (agentStatus !== 'milestone' && agentStatus !== 'blocked' && agentStatus !== 'done') {
      return errResult('agentStatus 必须是 milestone / blocked / done 之一')
    }
    const reportMd = optStr(input, 'reportMd')
    const stage = optStr(input, 'stage')
    const task = taskStore.get(taskId)
    if (!task) return errResult('任务不存在')
    try { assertProjectAccess(task, context?.projectId) } catch (e) { return errResult((e as Error).message) }

    try {
      const updated = taskManager.reportTask({ taskId, agentStatus, reportMd, stage })
      if (!updated) return errResult('任务不存在')
      return { content: [{ type: 'text', text: JSON.stringify({ taskId, status: updated.status, agentReportStatus: updated.agent_report_status }) }] }
    } catch (e) {
      return errResult((e as Error).message)
    }
  },
}

