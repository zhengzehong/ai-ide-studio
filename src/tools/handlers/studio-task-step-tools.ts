import type { ToolHandler } from '../types.js'
import { taskStore } from '../../store/tasks.js'
import { taskStepManager, type StepArtifact } from '../../core/task-steps.js'
import { reportStepAndDispatch } from '../../core/task-step-report.js'
import { requireStr, optStr, errResult, assertProjectAccess } from './studio-task-crud-tools.js'

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
  },
}
