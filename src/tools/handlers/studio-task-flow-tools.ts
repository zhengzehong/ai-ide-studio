import type { ToolHandler, ToolHandlerInput } from '../types.js'
import type { StepArtifact } from '../../core/task-steps.js'
import { taskStore } from '../../store/tasks.js'
import { emitTaskLifecycleEvent, resolveSessionMode, taskManager } from '../../core/tasks.js'
import { taskStepManager } from '../../core/task-steps.js'
import { reportStepAndDispatch } from '../../core/task-step-report.js'
import { events } from '../../core/events.js'
import { createChildLogger } from '../../core/logger.js'
import { requireStr, optStr, errResult, assertProjectAccess } from './studio-task-crud-tools.js'

const log = createChildLogger('studio-task-tools')

function parseArtifacts(value: unknown): StepArtifact[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .map(item => {
      if (!item || typeof item !== 'object') return null
      const obj = item as Record<string, unknown>
      const type = obj.type
      const val = obj.value
      if (typeof type !== 'string' || typeof val !== 'string') return null
      if (type !== 'commit' && type !== 'file' && type !== 'doc' && type !== 'url') return null
      return { type, value: val } as StepArtifact
    })
    .filter((v): v is StepArtifact => v !== null)
}

export const studioTaskStartHandler: ToolHandler = {
  name: 'studio.task.start',
  description: `启动任务,系统开始派发 ready 的 step。
- draft → running,开始派发
- running → running,幂等,重新评估全图(不是错误)
- completed → 报错(已完成不能重启)
- 已 running 的 step 不重派(避免重复派)
- 任务在 draft 状态时不会派发任何步骤。运行中如果编辑了步骤,任务会自动回退到 draft,需要再次调用此工具恢复执行。`,
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
    try {
      const result = await taskStepManager.startTask(taskId)
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            taskId,
            status: result.task.status,
            dispatched: result.dispatched,
          }, null, 2),
        }],
      }
    } catch (e) {
      return errResult((e as Error).message)
    }
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
    const newStatus = shouldRecover ? 'running' : task.status
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
      stepId: { type: 'string', description: '可选,协作任务的步骤 ID。不传走老逻辑(老任务)' },
      artifacts: {
        type: 'array',
        description: '可选,产出列表',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['commit', 'file', 'doc', 'url'] },
            value: { type: 'string' },
          },
        },
      },
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
    const stepId = optStr(input, 'stepId')
    const artifacts = parseArtifacts(input.artifacts)
    const task = taskStore.get(taskId)
    if (!task) return errResult('任务不存在')
    try { assertProjectAccess(task, context?.projectId) } catch (e) { return errResult((e as Error).message) }

    if (stepId) {
      if (!reportMd) return errResult('stepId 汇报必须传 reportMd')
      try {
        const result = await reportStepAndDispatch({
          taskId,
          stepId,
          agentStatus,
          reportMd,
          artifacts,
          agentId: context?.agentId,
          sessionId: context?.sessionId,
        })
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              taskId,
              stepId,
              newStatus: result.newStatus,
              unlockedSteps: result.unlockedSteps,
              dispatchedSteps: result.dispatchedSteps,
              dispatchFailure: result.dispatchFailure,
              taskCompleted: result.taskCompleted,
              taskStatus: taskStore.get(taskId)?.status,
            }, null, 2),
          }],
        }
      } catch (e) {
        return errResult((e as Error).message)
      }
    }

    try {
      const updated = taskManager.reportTask({
        taskId,
        agentStatus,
        reportMd,
        stage,
        initiatorAgentId: context?.agentId,
      })
      if (!updated) return errResult('任务不存在')
      return { content: [{ type: 'text', text: JSON.stringify({ taskId, status: updated.status, agentReportStatus: updated.agent_report_status }) }] }
    } catch (e) {
      return errResult((e as Error).message)
    }
  },
}

// Keep parseStrArray export for backward compat with any external consumers
export function parseStrArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map(v => String(v)).filter(v => v.length > 0)
}

// Silence unused import lints for re-exported helpers
export type { ToolHandlerInput }
