import { taskStore, taskEventStore, type TaskRow } from '../store/tasks.js'
import {
  taskStepStore,
  detectCycle,
  type TaskStepRow,
} from '../store/task-steps.js'
import { sessionManager } from './sessions.js'
import { events } from './events.js'
import { emitTaskLifecycleEvent } from './task-lifecycle-events.js'
import { dispatchStep, resolveStepSession, type DispatchStepResult } from './step-dispatch.js'
import { buildStepView, type StepView } from './step-view.js'
import { buildStepPrompt } from './step-prompt.js'
import { dispatchReadySteps } from './step-ready-dispatch.js'
import { triggerTaskWatch } from './task-watch-trigger.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('task-steps')

export type { DispatchStepResult, StepView }
export { buildStepPrompt, dispatchStep, resolveStepSession, buildStepView }

export interface StepArtifact {
  type: 'commit' | 'file' | 'doc' | 'url'
  value: string
}

export type StepAgentStatus = 'milestone' | 'blocked' | 'done'

export interface StepReportInput {
  taskId: string
  stepId: string
  agentStatus: StepAgentStatus
  reportMd: string
  artifacts?: StepArtifact[]
  agentId?: string
  sessionId?: string
}

function isTerminalTask(status: string): boolean {
  return status === 'completed' || status === 'cancelled'
}

function shouldRevert(status: string): boolean {
  return status === 'running' || status === 'needs_input'
}

function revertTaskToDraft(taskId: string, triggerStepId: string, action: 'step_added' | 'step_updated' | 'step_removed', previousStatus: string): void {
  taskStore.updateStatus(taskId, 'draft', '步骤图已变更,回退到草稿')
  taskEventStore.append(taskId, {
    type: 'task_reverted',
    payload: { triggerStepId, triggerAction: action },
  })
  const t = taskStore.get(taskId)
  if (t) {
    events.emit('task:update', { taskId, data: { ...t, event: 'reverted' } })
    emitTaskLifecycleEvent(t, 'status_changed', previousStatus)
    triggerTaskWatch('task_reverted', taskId, t, triggerStepId)
  }
}

export const taskStepManager = {
  addStep(input: {
    taskId: string
    title: string
    description?: string
    assignee?: string
    sessionId?: string
    dependsOn?: string[]
  }): { step: TaskStepRow; reverted: boolean } {
    const task = taskStore.get(input.taskId)
    if (!task) throw new Error(`任务不存在: ${input.taskId}`)
    if (isTerminalTask(task.status)) throw new Error('任务已完成或已取消,不能添加步骤')

    const deps = input.dependsOn ?? []
    const existing = taskStepStore.listByTask(input.taskId)
    const existingIds = new Set(existing.map(s => s.id))
    for (const dep of deps) {
      if (!existingIds.has(dep)) throw new Error(`依赖的步骤不存在: ${dep}`)
    }

    if (detectCycle(input.taskId, '__pending__', deps)) {
      throw new Error('检测到循环依赖,拒绝添加步骤')
    }

    const reverted = shouldRevert(task.status)
    const step = taskStepStore.create({
      taskId: input.taskId,
      title: input.title,
      description: input.description,
      assigneeAgentId: input.assignee,
      sessionId: input.sessionId,
      dependsOn: deps,
    })

    if (reverted) {
      revertTaskToDraft(input.taskId, step.id, 'step_added', task.status)
    }

    taskEventStore.append(input.taskId, {
      type: 'step_added',
      payload: {
        stepId: step.id,
        title: step.title,
        assignee: step.assignee_agent_id,
        dependsOn: deps,
      },
    })
    log.info({ taskId: input.taskId, stepId: step.id, reverted }, 'step added')
    return { step, reverted }
  },

  updateStep(input: {
    taskId: string
    stepId: string
    title?: string
    description?: string | null
    assignee?: string | null
    sessionId?: string | null
    dependsOn?: string[]
  }): { step: TaskStepRow; reverted: boolean } {
    const task = taskStore.get(input.taskId)
    if (!task) throw new Error(`任务不存在: ${input.taskId}`)
    if (isTerminalTask(task.status)) throw new Error('任务已完成或已取消,不能修改步骤')
    const existing = taskStepStore.get(input.stepId)
    if (!existing || existing.task_id !== input.taskId) {
      throw new Error(`步骤不存在: ${input.stepId}`)
    }

    if (input.dependsOn !== undefined) {
      const all = taskStepStore.listByTask(input.taskId)
      const ids = new Set(all.map(s => s.id))
      for (const dep of input.dependsOn) {
        if (dep === input.stepId) throw new Error('步骤不能依赖自己')
        if (!ids.has(dep)) throw new Error(`依赖的步骤不存在: ${dep}`)
      }
      if (detectCycle(input.taskId, input.stepId, input.dependsOn)) {
        throw new Error('检测到循环依赖,拒绝修改步骤')
      }
    }

    const reverted = shouldRevert(task.status)
    const updated = taskStepStore.update(input.taskId, input.stepId, {
      title: input.title,
      description: input.description,
      assigneeAgentId: input.assignee,
      sessionId: input.sessionId,
      dependsOn: input.dependsOn,
    })
    if (!updated) throw new Error(`步骤更新失败: ${input.stepId}`)

    if (reverted) {
      revertTaskToDraft(input.taskId, input.stepId, 'step_updated', task.status)
    }

    taskEventStore.append(input.taskId, {
      type: 'step_updated',
      payload: {
        stepId: input.stepId,
        changes: {
          title: input.title,
          description: input.description,
          assignee: input.assignee,
          sessionId: input.sessionId,
          dependsOn: input.dependsOn,
        },
      },
    })
    log.info({ taskId: input.taskId, stepId: input.stepId, reverted }, 'step updated')
    return { step: updated, reverted }
  },

  removeStep(input: { taskId: string; stepId: string }): { reverted: boolean; cancelledSessionId: string | null } {
    const task = taskStore.get(input.taskId)
    if (!task) throw new Error(`任务不存在: ${input.taskId}`)
    if (isTerminalTask(task.status)) throw new Error('任务已完成或已取消,不能删除步骤')
    const existing = taskStepStore.get(input.stepId)
    if (!existing || existing.task_id !== input.taskId) {
      throw new Error(`步骤不存在: ${input.stepId}`)
    }

    const wasRunning = existing.status === 'running'
    const cancelledSessionId = wasRunning ? existing.session_id ?? null : null

    const reverted = shouldRevert(task.status)
    taskStepStore.delete(input.taskId, input.stepId)

    if (reverted) {
      revertTaskToDraft(input.taskId, input.stepId, 'step_removed', task.status)
    }

    taskEventStore.append(input.taskId, {
      type: 'step_removed',
      payload: { stepId: input.stepId },
    })

    if (cancelledSessionId) {
      const notice = `[系统通知] 步骤 #${input.stepId} 已被取消,请停止当前工作。`
      sessionManager.enqueuePrompt(cancelledSessionId, notice).catch((err: Error) => {
        log.warn({ err, sessionId: cancelledSessionId, stepId: input.stepId }, 'failed to notify cancelled step')
      })
    }

    log.info({ taskId: input.taskId, stepId: input.stepId, reverted, cancelledSessionId }, 'step removed')
    return { reverted, cancelledSessionId }
  },

  updateProgress(input: { taskId: string; stepId: string; stage: string }): TaskStepRow {
    const task = taskStore.get(input.taskId)
    if (!task) throw new Error(`任务不存在: ${input.taskId}`)
    const step = taskStepStore.get(input.stepId)
    if (!step || step.task_id !== input.taskId) throw new Error(`步骤不存在: ${input.stepId}`)
    if (step.status !== 'running') throw new Error('只有 running 中的步骤可以更新进度')

    taskStepStore.updateStage(input.stepId, input.stage)
    taskEventStore.append(input.taskId, {
      type: 'step_progress',
      payload: { stepId: input.stepId, stage: input.stage },
    })
    const updated = taskStepStore.get(input.stepId)!
    events.emit('task:update', {
      taskId: input.taskId,
      data: { stepId: input.stepId, stage: input.stage, event: 'step_progress' },
    })
    return updated
  },

  reportStep(input: StepReportInput): {
    step: TaskStepRow
    newStatus: string
    unlockedSteps: string[]
    taskCompleted: boolean
  } {
    const task = taskStore.get(input.taskId)
    if (!task) throw new Error(`任务不存在: ${input.taskId}`)
    const step = taskStepStore.get(input.stepId)
    if (!step || step.task_id !== input.taskId) throw new Error(`步骤不存在: ${input.stepId}`)
    if (step.status !== 'running' && step.status !== 'blocked') {
      throw new Error(`只有 running/blocked 中的步骤可以汇报,当前状态: ${step.status}`)
    }

    const previousStatus = step.status
    let nextStepStatus = step.status
    if (input.agentStatus === 'milestone') {
      nextStepStatus = 'running'
    } else if (input.agentStatus === 'blocked') {
      nextStepStatus = 'blocked'
    } else if (input.agentStatus === 'done') {
      nextStepStatus = 'done'
    }

    taskStepStore.updateStatus(input.stepId, nextStepStatus)
    taskEventStore.append(input.taskId, {
      type: 'step_report',
      payload: {
        stepId: input.stepId,
        agentStatus: input.agentStatus,
        reportMd: input.reportMd,
        artifacts: input.artifacts ?? null,
        agentId: input.agentId ?? step.assignee_agent_id ?? null,
        sessionId: input.sessionId ?? step.session_id ?? null,
      },
    })

    const unlockedSteps = input.agentStatus === 'done' && task.status === 'running'
      ? unlockDependents(input.taskId, input.stepId)
      : []

    let taskCompleted = false
    if (input.agentStatus === 'done' && task.status === 'running') {
      const all = taskStepStore.listByTask(input.taskId)
      const allDone = all.length > 0 && all.every(s => s.status === 'done')
      if (allDone) {
        notifyInitiatorIfNotLastExecutor(input.taskId, step, 'all_done')
        const t = taskStore.get(input.taskId)
        if (t) {
          const doneStep = taskStepStore.get(input.stepId)!
          triggerTaskWatch('task_completed', input.taskId, t, input.stepId, doneStep)
        }
      } else {
        const t = taskStore.get(input.taskId)
        if (t) {
          const doneStep = taskStepStore.get(input.stepId)!
          triggerTaskWatch('step_done', input.taskId, t, input.stepId, doneStep)
        }
      }
    }

    if (input.agentStatus === 'blocked' && task.status === 'running') {
      notifyInitiatorIfNotLastExecutor(input.taskId, step, 'blocked')
      const t = taskStore.get(input.taskId)
      if (t) {
        events.emit('task:update', { taskId: input.taskId, data: { ...t, event: 'step_blocked' } })
        const blockedStep = taskStepStore.get(input.stepId)!
        triggerTaskWatch('step_blocked', input.taskId, t, input.stepId, blockedStep)
      }
    }

    const updatedStep = taskStepStore.get(input.stepId)!
    log.info(
      {
        taskId: input.taskId,
        stepId: input.stepId,
        from: previousStatus,
        to: nextStepStatus,
        unlocked: unlockedSteps,
        taskCompleted,
      },
      'step reported',
    )
    return { step: updatedStep, newStatus: nextStepStatus, unlockedSteps, taskCompleted }
  },

  async startTask(taskId: string): Promise<{ task: TaskRow; dispatched: string[] }> {
    const task = taskStore.get(taskId)
    if (!task) throw new Error(`任务不存在: ${taskId}`)
    if (isTerminalTask(task.status)) throw new Error('任务已完成或已取消,不能启动')

    const previousStatus = task.status
    if (task.status !== 'running') {
      taskStore.updateStatus(taskId, 'running', '任务已启动')
    }
    taskEventStore.append(taskId, {
      type: 'task_started',
      payload: { previousStatus },
    })

    const all = taskStepStore.listByTask(taskId)
    const readyCandidates: TaskStepRow[] = []
    for (const step of all) {
      if (step.status === 'pending') {
        const deps = taskStepStore.listDependencies(step.id)
        const allDone = deps.every(d => taskStepStore.get(d)?.status === 'done')
        if (allDone) {
          taskStepStore.updateStatus(step.id, 'ready')
          readyCandidates.push(step)
        }
      } else if (step.status === 'ready') {
        readyCandidates.push(step)
      }
    }

    const dispatched = (await dispatchReadySteps(taskId, readyCandidates.map((step) => step.id))).dispatchedSteps

    const updated = taskStore.get(taskId)!
    if (previousStatus !== 'running') {
      emitTaskLifecycleEvent(updated, 'status_changed', previousStatus)
    }
    events.emit('task:update', { taskId, data: { ...updated, event: 'started', dispatched } })
    log.info({ taskId, previousStatus, dispatched }, 'task started')
    return { task: updated, dispatched }
  },

  buildStepView(taskId: string, stepId: string): StepView | null {
    return buildStepView(taskId, stepId)
  },

  dispatchStep,
  resolveStepSession,
}

function unlockDependents(taskId: string, stepId: string): string[] {
  const unlocked: string[] = []
  const dependents = taskStepStore.listDependents(stepId)
  for (const depId of dependents) {
    const dep = taskStepStore.get(depId)
    if (!dep || dep.task_id !== taskId) continue
    if (dep.status !== 'pending') continue
    const deps = taskStepStore.listDependencies(depId)
    const allDone = deps.every(d => {
      const s = taskStepStore.get(d)
      return s?.status === 'done'
    })
    if (allDone) {
      taskStepStore.updateStatus(depId, 'ready')
      unlocked.push(depId)
    }
  }
  return unlocked
}

function notifyInitiatorIfNotLastExecutor(
  taskId: string,
  lastStep: TaskStepRow,
  kind: 'all_done' | 'blocked',
): void {
  const task = taskStore.get(taskId)
  if (!task) return
  if (!task.initiator_agent_id || !task.initiator_session_id) return
  if (lastStep.assignee_agent_id === task.initiator_agent_id) return

  const notice =
    kind === 'all_done'
      ? `[任务完成] ${task.title} 所有步骤已完成,请用 task.report(agentStatus=done) 拍板`
      : `[步骤卡住] ${task.title} 的步骤 ${lastStep.title} 卡住,请决策:加步骤或 task.report(blocked)`

  sessionManager.enqueuePrompt(task.initiator_session_id, notice).catch((err: Error) => {
    log.warn(
      { err, taskId, initiatorSessionId: task.initiator_session_id, kind },
      'failed to notify initiator',
    )
  })
}
