import type { ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'
import { taskStore } from '../../store/tasks.js'
import { sessionStore } from '../../store/sessions.js'
import { taskStepStore } from '../../store/task-steps.js'
import { emitTaskLifecycleEvent, resolveSessionMode, taskManager } from '../../core/tasks.js'
import { taskStepManager, buildStepPrompt, type StepArtifact } from '../../core/task-steps.js'
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

function parseStrArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map(v => String(v)).filter(v => v.length > 0)
}

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
      try {
        const result = taskStepManager.reportStep({
          taskId,
          stepId,
          agentStatus,
          reportMd: reportMd ?? '',
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
      const updated = taskManager.reportTask({ taskId, agentStatus, reportMd, stage })
      if (!updated) return errResult('任务不存在')
      return { content: [{ type: 'text', text: JSON.stringify({ taskId, status: updated.status, agentReportStatus: updated.agent_report_status }) }] }
    } catch (e) {
      return errResult((e as Error).message)
    }
  },
}

export const studioTaskStepGetHandler: ToolHandler = {
  name: 'studio.task.step.get',
  description: '取单个步骤的完整详情 + 历史汇报。',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 ID' },
      stepId: { type: 'string', description: '步骤 ID' },
    },
    required: ['taskId', 'stepId'],
  },
  async execute(input, context) {
    const taskId = requireStr(input, 'taskId')
    const stepId = requireStr(input, 'stepId')
    const task = taskStore.get(taskId)
    if (!task) return errResult('任务不存在')
    try { assertProjectAccess(task, context?.projectId) } catch (e) { return errResult((e as Error).message) }
    const view = taskStepManager.buildStepView(taskId, stepId)
    if (!view) return errResult('步骤不存在')
    return { content: [{ type: 'text', text: JSON.stringify(view, null, 2) }] }
  },
}

export const studioTaskStepAddHandler: ToolHandler = {
  name: 'studio.task.step.add',
  description: `给任务添加步骤。
- ⚠️ 调用此工具会使任务回退到 draft 状态,系统暂停派发。
- 完成所有步骤编辑后,必须调用 task.start 重新启动任务。
- dependsOn 里的 stepId 必须存在,不存在报错。
- 系统检测循环依赖,有循环拒绝创建。`,
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 ID' },
      title: { type: 'string', description: '步骤标题' },
      description: { type: 'string', description: '做什么' },
      assignee: { type: 'string', description: '可选,分派给哪个 Agent(不传 = 待认领)' },
      sessionId: { type: 'string', description: '可选,指定会话(不传系统按 assignee 找/建)' },
      dependsOn: { type: 'array', items: { type: 'string' }, description: '可选,前置 stepId 数组(不传 = 无依赖,ready)' },
    },
    required: ['taskId', 'title'],
  },
  async execute(input, context) {
    const taskId = requireStr(input, 'taskId')
    const title = requireStr(input, 'title')
    const task = taskStore.get(taskId)
    if (!task) return errResult('任务不存在')
    try { assertProjectAccess(task, context?.projectId) } catch (e) { return errResult((e as Error).message) }
    try {
      const result = taskStepManager.addStep({
        taskId,
        title,
        description: optStr(input, 'description'),
        assignee: optStr(input, 'assignee'),
        sessionId: optStr(input, 'sessionId'),
        dependsOn: parseStrArray(input.dependsOn),
      })
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            stepId: result.step.id,
            taskId,
            title: result.step.title,
            status: result.step.status,
            reverted: result.reverted,
            taskStatus: taskStore.get(taskId)?.status,
          }, null, 2),
        }],
      }
    } catch (e) {
      return errResult((e as Error).message)
    }
  },
}

export const studioTaskStepUpdateHandler: ToolHandler = {
  name: 'studio.task.step.update',
  description: `修改步骤(标题/描述/依赖/分派)。
- ⚠️ 调用此工具会使任务回退到 draft 状态,系统暂停派发。
- 批量改多个步骤后,调用 task.start 重新启动。
- dependsOn 整体替换,不是追加。要加依赖先 get 当前依赖再合并。
- 已 running 的 step 改了 assignee,不强行收回,下次轮次按新 assignee。
- 系统检测循环依赖,有循环拒绝修改。`,
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 ID' },
      stepId: { type: 'string', description: '步骤 ID' },
      title: { type: 'string' },
      description: { type: 'string' },
      dependsOn: { type: 'array', items: { type: 'string' }, description: '传新数组,整体替换' },
      assignee: { type: 'string' },
      sessionId: { type: 'string' },
    },
    required: ['taskId', 'stepId'],
  },
  async execute(input, context) {
    const taskId = requireStr(input, 'taskId')
    const stepId = requireStr(input, 'stepId')
    const task = taskStore.get(taskId)
    if (!task) return errResult('任务不存在')
    try { assertProjectAccess(task, context?.projectId) } catch (e) { return errResult((e as Error).message) }
    try {
      const result = taskStepManager.updateStep({
        taskId,
        stepId,
        title: optStr(input, 'title'),
        description: input.description !== undefined ? String(input.description) : undefined,
        assignee: input.assignee !== undefined ? (typeof input.assignee === 'string' ? input.assignee : null) : undefined,
        sessionId: input.sessionId !== undefined ? (typeof input.sessionId === 'string' ? input.sessionId : null) : undefined,
        dependsOn: parseStrArray(input.dependsOn),
      })
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            stepId: result.step.id,
            taskId,
            title: result.step.title,
            status: result.step.status,
            reverted: result.reverted,
            taskStatus: taskStore.get(taskId)?.status,
          }, null, 2),
        }],
      }
    } catch (e) {
      return errResult((e as Error).message)
    }
  },
}

export const studioTaskStepRemoveHandler: ToolHandler = {
  name: 'studio.task.step.remove',
  description: `删除步骤。
- ⚠️ 调用此工具会使任务回退到 draft 状态,系统暂停派发。
- 改完调用 task.start 重新启动。
- 任意状态都可删。
- 删除时系统自动清理下游依赖(下游 dependsOn 里去掉这个 id)。
- 删 running 步骤,向对应会话发"步骤已取消"通知,不强停当前轮次。`,
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 ID' },
      stepId: { type: 'string', description: '步骤 ID' },
    },
    required: ['taskId', 'stepId'],
  },
  async execute(input, context) {
    const taskId = requireStr(input, 'taskId')
    const stepId = requireStr(input, 'stepId')
    const task = taskStore.get(taskId)
    if (!task) return errResult('任务不存在')
    try { assertProjectAccess(task, context?.projectId) } catch (e) { return errResult((e as Error).message) }
    try {
      const result = taskStepManager.removeStep({ taskId, stepId })
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            taskId,
            stepId,
            removed: true,
            reverted: result.reverted,
            cancelledSessionId: result.cancelledSessionId,
            taskStatus: taskStore.get(taskId)?.status,
          }, null, 2),
        }],
      }
    } catch (e) {
      return errResult((e as Error).message)
    }
  },
}

export const studioTaskStepUpdateProgressHandler: ToolHandler = {
  name: 'studio.task.step.updateProgress',
  description: `更新步骤进度(一句话,展示用)。
- 轻量进度更新,不带产出,不标记节点,纯展示。
- 不改变 step 状态(step 还是 running)。
- 用于让 PM/用户看到"做到哪了"。`,
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 ID' },
      stepId: { type: 'string', description: '步骤 ID' },
      stage: { type: 'string', description: '一句话描述当前阶段,如"正在写数据库层"' },
    },
    required: ['taskId', 'stepId', 'stage'],
  },
  async execute(input, context) {
    const taskId = requireStr(input, 'taskId')
    const stepId = requireStr(input, 'stepId')
    const stage = requireStr(input, 'stage')
    const task = taskStore.get(taskId)
    if (!task) return errResult('任务不存在')
    try { assertProjectAccess(task, context?.projectId) } catch (e) { return errResult((e as Error).message) }
    try {
      const updated = taskStepManager.updateProgress({ taskId, stepId, stage })
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            taskId,
            stepId,
            status: updated.status,
            stage: updated.current_stage,
          }, null, 2),
        }],
      }
    } catch (e) {
      return errResult((e as Error).message)
    }
  },
}

export const studioTaskStepReportHandler: ToolHandler = {
  name: 'studio.task.step.report',
  description: `步骤汇报(关键节点/卡住/完成)。
- milestone:过程标记,step 保持 running,继续做。一个 step 可多次 milestone。
- blocked:卡住,等人工决策。PM 介入后可继续。
- done:完成,解锁下游。系统自动检查下游,ready 的在 running 状态下会派发。
- ⚠️ 没有 rejected。审查不通过 = 审查 step done(产出"不通过报告") + 新增修复 step + 新增重审 step + 更新下游依赖。
- 任务在 draft 状态时 report 不解锁下游(但记录汇报),需 task.start 后才派发。`,
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 ID' },
      stepId: { type: 'string', description: '步骤 ID' },
      agentStatus: { type: 'string', enum: ['milestone', 'blocked', 'done'] },
      reportMd: { type: 'string', description: '报告内容(Markdown)' },
      artifacts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['commit', 'file', 'doc', 'url'] },
            value: { type: 'string' },
          },
        },
      },
    },
    required: ['taskId', 'stepId', 'agentStatus', 'reportMd'],
  },
  async execute(input, context) {
    const taskId = requireStr(input, 'taskId')
    const stepId = requireStr(input, 'stepId')
    const agentStatus = requireStr(input, 'agentStatus')
    if (agentStatus !== 'milestone' && agentStatus !== 'blocked' && agentStatus !== 'done') {
      return errResult('agentStatus 必须是 milestone / blocked / done 之一')
    }
    const reportMd = requireStr(input, 'reportMd')
    const artifacts = parseArtifacts(input.artifacts)
    const task = taskStore.get(taskId)
    if (!task) return errResult('任务不存在')
    try { assertProjectAccess(task, context?.projectId) } catch (e) { return errResult((e as Error).message) }
    try {
      const result = taskStepManager.reportStep({
        taskId,
        stepId,
        agentStatus,
        reportMd,
        artifacts,
        agentId: context?.agentId,
        sessionId: context?.sessionId,
      })
      if (task.status === 'running' && result.unlockedSteps.length > 0) {
        for (const unlockedId of result.unlockedSteps) {
          const step = taskStepStore.get(unlockedId)
          if (step && step.assignee_agent_id) {
            try {
              await taskStepManager.dispatchStep(taskId, unlockedId)
            } catch (err) {
              log.warn({ err, taskId, stepId: unlockedId }, 'failed to auto-dispatch unlocked step')
            }
          }
        }
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            taskId,
            stepId,
            newStatus: result.newStatus,
            unlockedSteps: result.unlockedSteps,
            taskCompleted: result.taskCompleted,
            taskStatus: taskStore.get(taskId)?.status,
          }, null, 2),
        }],
      }
    } catch (e) {
      return errResult((e as Error).message)
    }
  },
}
