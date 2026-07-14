import { taskStore, type TaskRow } from '../store/tasks.js'
import { taskStepStore, type TaskStepRow } from '../store/task-steps.js'
import { agentStore } from '../store/agents.js'
import { sessionStore } from '../store/sessions.js'
import { sessionManager } from './sessions.js'
import { events } from './events.js'
import { emitTaskLifecycleEvent } from './task-lifecycle-events.js'
import { buildStepPrompt } from './step-prompt.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('step-dispatch')

export interface DispatchStepResult {
  stepId: string
  sessionId: string
  reused: boolean
}

export async function resolveStepSession(
  task: TaskRow,
  step: TaskStepRow,
): Promise<{ id: string; reuse: boolean }> {
  if (step.session_id) {
    const existing = sessionStore.get(step.session_id)
    if (!existing) throw new Error(`会话不存在: ${step.session_id}`)
    if (existing.agent_id !== step.assignee_agent_id) {
      throw new Error('步骤指定会话不属于被指派 Agent')
    }
    return { id: step.session_id, reuse: true }
  }
  if (!step.assignee_agent_id) throw new Error('步骤未指派 Agent')
  const primary = sessionStore.findPrimaryByAgent(step.assignee_agent_id)
  if (primary) return { id: primary.id, reuse: true }
  const created = await sessionManager.createSession(step.assignee_agent_id, task.id, task.project_id ?? undefined)
  return { id: created.id, reuse: false }
}

export async function dispatchStep(taskId: string, stepId: string): Promise<DispatchStepResult> {
  const task = taskStore.get(taskId)
  if (!task) throw new Error(`任务不存在: ${taskId}`)
  if (task.status !== 'running') throw new Error(`任务非 running 状态,不能派发步骤: ${task.status}`)
  const step = taskStepStore.get(stepId)
  if (!step || step.task_id !== taskId) throw new Error(`步骤不存在: ${stepId}`)
  if (step.status !== 'ready') throw new Error(`步骤非 ready 状态,不能派发: ${step.status}`)
  if (!step.assignee_agent_id) throw new Error('步骤未指派 Agent,不能派发')

  const agent = agentStore.get(step.assignee_agent_id)
  if (!agent) throw new Error(`Agent 不存在: ${step.assignee_agent_id}`)
  if (task.project_id && agent.project_id && agent.project_id !== task.project_id) {
    throw new Error('步骤指派 Agent 不属于任务所在项目')
  }

  const session = await resolveStepSession(task, step)
  taskStepStore.updateStatus(stepId, 'running')
  taskStepStore.setSessionId(stepId, session.id)
  taskStore.linkSession(taskId, session.id)

  const prompt = buildStepPrompt(taskId, stepId)
  const queued = sessionManager.enqueuePrompt(session.id, prompt)
  queued.catch((err: Error) => {
    log.error({ err, taskId, stepId, sessionId: session.id }, 'step dispatch prompt failed')
    taskStepStore.updateStatus(stepId, 'ready')
    taskStore.updateStatus(taskId, 'needs_input', `步骤派发失败: ${err.message}`)
    const t = taskStore.get(taskId)
    if (t) {
      events.emit('task:update', { taskId, data: { ...t, event: 'step_dispatch_failed' } })
      emitTaskLifecycleEvent(t, 'prompt_failed', 'running')
    }
    throw err
  })

  log.info({ taskId, stepId, sessionId: session.id, reuse: session.reuse }, 'step dispatched')
  return { stepId, sessionId: session.id, reused: session.reuse }
}
