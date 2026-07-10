import { taskStepManager, type StepArtifact } from '../../core/task-steps.js'
import { taskStore } from '../../store/tasks.js'
import type { RpcHandlerMap } from './types.js'
import { buildStepProgress, buildStepSummary, buildStepViewRpc, buildTaskStepList } from './step-views.js'

export const taskStepRpcHandlers: RpcHandlerMap = {
  async 'tasks.start'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    if (!taskId) return sendError('taskId 不能为空')
    try {
      const result = await taskStepManager.startTask(taskId)
      sendResult({
        taskId,
        status: result.task.status,
        dispatched: result.dispatched,
        steps: buildTaskStepList(taskId),
        stepProgress: buildStepProgress(taskId),
      })
    } catch (err) {
      sendError((err as Error).message)
    }
  },

  'tasks.step.list'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    if (!taskId) return sendError('taskId 不能为空')
    const task = taskStore.get(taskId)
    if (!task) return sendError('任务不存在')
    sendResult({
      taskId,
      steps: buildTaskStepList(taskId),
      stepProgress: buildStepProgress(taskId),
    })
  },

  'tasks.step.add'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    if (!taskId) return sendError('taskId 不能为空')
    const title = (msg.title as string | undefined)?.trim()
    if (!title) return sendError('title 不能为空')
    const task = taskStore.get(taskId)
    if (!task) return sendError('任务不存在')
    try {
      const result = taskStepManager.addStep({
        taskId,
        title,
        description: typeof msg.description === 'string' ? msg.description : undefined,
        assignee: typeof msg.assignee === 'string' ? msg.assignee : undefined,
        sessionId: typeof msg.sessionId === 'string' ? msg.sessionId : undefined,
        dependsOn: Array.isArray(msg.dependsOn) ? (msg.dependsOn as string[]).filter(Boolean) : undefined,
      })
      sendResult(stepMutationResult(taskId, result.step.id, result.reverted))
    } catch (err) {
      sendError((err as Error).message)
    }
  },

  'tasks.step.update'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    const stepId = msg.stepId as string
    if (!taskId || !stepId) return sendError('taskId/stepId 不能为空')
    const task = taskStore.get(taskId)
    if (!task) return sendError('任务不存在')
    try {
      const result = taskStepManager.updateStep({
        taskId,
        stepId,
        title: typeof msg.title === 'string' ? msg.title : undefined,
        description:
          msg.description !== undefined ? (typeof msg.description === 'string' ? msg.description : null) : undefined,
        assignee: msg.assignee !== undefined ? (typeof msg.assignee === 'string' ? msg.assignee : null) : undefined,
        sessionId: msg.sessionId !== undefined ? (typeof msg.sessionId === 'string' ? msg.sessionId : null) : undefined,
        dependsOn: Array.isArray(msg.dependsOn) ? (msg.dependsOn as string[]) : undefined,
      })
      sendResult(stepMutationResult(taskId, result.step.id, result.reverted))
    } catch (err) {
      sendError((err as Error).message)
    }
  },

  'tasks.step.remove'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    const stepId = msg.stepId as string
    if (!taskId || !stepId) return sendError('taskId/stepId 不能为空')
    const task = taskStore.get(taskId)
    if (!task) return sendError('任务不存在')
    try {
      const result = taskStepManager.removeStep({ taskId, stepId })
      sendResult({
        taskId,
        stepId,
        removed: true,
        reverted: result.reverted,
        cancelledSessionId: result.cancelledSessionId,
        taskStatus: taskStore.get(taskId)?.status,
        steps: buildTaskStepList(taskId),
        stepProgress: buildStepProgress(taskId),
      })
    } catch (err) {
      sendError((err as Error).message)
    }
  },

  'tasks.step.get'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    const stepId = msg.stepId as string
    if (!taskId || !stepId) return sendError('taskId/stepId 不能为空')
    try {
      sendResult(buildStepViewRpc(taskId, stepId))
    } catch (err) {
      sendError((err as Error).message)
    }
  },

  'tasks.step.updateProgress'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    const stepId = msg.stepId as string
    const stage = msg.stage as string | undefined
    if (!taskId || !stepId) return sendError('taskId/stepId 不能为空')
    if (!stage || !stage.trim()) return sendError('stage 不能为空')
    try {
      const updated = taskStepManager.updateProgress({ taskId, stepId, stage })
      sendResult({
        taskId,
        stepId,
        status: updated.status,
        stage: updated.current_stage,
        steps: buildTaskStepList(taskId),
      })
    } catch (err) {
      sendError((err as Error).message)
    }
  },

  async 'tasks.step.report'(msg, { sendResult, sendError }) {
    const taskId = msg.taskId as string
    const stepId = msg.stepId as string
    const agentStatus = msg.agentStatus as string | undefined
    const reportMd = msg.reportMd as string | undefined
    if (!taskId || !stepId) return sendError('taskId/stepId 不能为空')
    if (agentStatus !== 'milestone' && agentStatus !== 'blocked' && agentStatus !== 'done') {
      return sendError('agentStatus 必须是 milestone / blocked / done 之一')
    }
    if (!reportMd) return sendError('reportMd 不能为空')
    const task = taskStore.get(taskId)
    if (!task) return sendError('任务不存在')
    try {
      const result = taskStepManager.reportStep({
        taskId,
        stepId,
        agentStatus,
        reportMd,
        artifacts: parseStepArtifacts(msg.artifacts),
      })
      sendResult({
        taskId,
        stepId,
        newStatus: result.newStatus,
        unlockedSteps: result.unlockedSteps,
        taskCompleted: result.taskCompleted,
        taskStatus: taskStore.get(taskId)?.status,
        steps: buildTaskStepList(taskId),
        stepProgress: buildStepProgress(taskId),
      })
    } catch (err) {
      sendError((err as Error).message)
    }
  },
}

function stepMutationResult(taskId: string, stepId: string, reverted: boolean): Record<string, unknown> {
  return {
    taskId,
    step: buildStepSummary(taskId, stepId),
    reverted,
    taskStatus: taskStore.get(taskId)?.status,
    steps: buildTaskStepList(taskId),
    stepProgress: buildStepProgress(taskId),
  }
}

function parseStepArtifacts(raw: unknown): StepArtifact[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const obj = item as Record<string, unknown>
      const type = obj.type
      const value = obj.value
      if (typeof type !== 'string' || typeof value !== 'string') return null
      if (type !== 'commit' && type !== 'file' && type !== 'doc' && type !== 'url') return null
      return { type, value } as StepArtifact
    })
    .filter((item): item is StepArtifact => item !== null)
}
