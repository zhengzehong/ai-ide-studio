import { taskStore, taskEventStore, type TaskRow } from '../store/tasks.js'
import {
  taskStepStore,
  detectCycle,
  getStepReports,
  type TaskStepRow,
} from '../store/task-steps.js'
import { agentStore } from '../store/agents.js'
import { sessionStore } from '../store/sessions.js'
import { sessionManager } from './sessions.js'
import { events } from './events.js'
import { emitTaskLifecycleEvent } from './task-lifecycle-events.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('task-steps')

export type StepAgentStatus = 'milestone' | 'blocked' | 'done'

export interface StepArtifact {
  type: 'commit' | 'file' | 'doc' | 'url'
  value: string
}

export interface StepReportInput {
  taskId: string
  stepId: string
  agentStatus: StepAgentStatus
  reportMd: string
  artifacts?: StepArtifact[]
  agentId?: string
  sessionId?: string
}

export interface DispatchStepResult {
  stepId: string
  sessionId: string
  reused: boolean
}

export interface StepView {
  id: string
  title: string
  description: string | null
  status: string
  assignee: string | null
  sessionId: string | null
  dependsOn: string[]
  currentStage: string | null
  reports: Array<{
    agentStatus: string
    reportMd: string | null
    artifacts?: StepArtifact[]
    agentId: string
    sessionId: string
    time: string
  }>
}

function isTerminalTask(status: string): boolean {
  return status === 'completed' || status === 'cancelled'
}

function isStepTerminal(status: string): boolean {
  return status === 'done' || status === 'blocked'
}

function describeStepStatusForPrompt(step: TaskStepRow, isSelf: boolean): string {
  const tag = isSelf ? `${step.status} ← 你在这里` : step.status
  return tag
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

    const reverted = task.status === 'running' || task.status === 'needs_input'
    const step = taskStepStore.create({
      taskId: input.taskId,
      title: input.title,
      description: input.description,
      assigneeAgentId: input.assignee,
      sessionId: input.sessionId,
      dependsOn: deps,
    })

    if (reverted) {
      taskStore.updateStatus(input.taskId, 'draft', '步骤图已变更,回退到草稿')
      taskEventStore.append(input.taskId, {
        type: 'task_reverted',
        payload: { triggerStepId: step.id, triggerAction: 'step_added' },
      })
      const updated = taskStore.get(input.taskId)
      if (updated) {
        events.emit('task:update', { taskId: input.taskId, data: { ...updated, event: 'reverted' } })
        emitTaskLifecycleEvent(updated, 'status_changed', task.status)
      }
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

    const reverted = task.status === 'running' || task.status === 'needs_input'
    const updated = taskStepStore.update(input.taskId, input.stepId, {
      title: input.title,
      description: input.description,
      assigneeAgentId: input.assignee,
      sessionId: input.sessionId,
      dependsOn: input.dependsOn,
    })
    if (!updated) throw new Error(`步骤更新失败: ${input.stepId}`)

    if (reverted) {
      taskStore.updateStatus(input.taskId, 'draft', '步骤图已变更,回退到草稿')
      taskEventStore.append(input.taskId, {
        type: 'task_reverted',
        payload: { triggerStepId: input.stepId, triggerAction: 'step_updated' },
      })
      const t = taskStore.get(input.taskId)
      if (t) {
        events.emit('task:update', { taskId: input.taskId, data: { ...t, event: 'reverted' } })
        emitTaskLifecycleEvent(t, 'status_changed', task.status)
      }
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

    const reverted = task.status === 'running' || task.status === 'needs_input'
    taskStepStore.delete(input.taskId, input.stepId)

    if (reverted) {
      taskStore.updateStatus(input.taskId, 'draft', '步骤图已变更,回退到草稿')
      taskEventStore.append(input.taskId, {
        type: 'task_reverted',
        payload: { triggerStepId: input.stepId, triggerAction: 'step_removed' },
      })
      const t = taskStore.get(input.taskId)
      if (t) {
        events.emit('task:update', { taskId: input.taskId, data: { ...t, event: 'reverted' } })
        emitTaskLifecycleEvent(t, 'status_changed', task.status)
      }
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

    const unlockedSteps: string[] = []
    if (input.agentStatus === 'done' && task.status === 'running') {
      const dependents = taskStepStore.listDependents(input.stepId)
      for (const depId of dependents) {
        const dep = taskStepStore.get(depId)
        if (!dep || dep.task_id !== input.taskId) continue
        if (dep.status !== 'pending') continue
        const deps = taskStepStore.listDependencies(depId)
        const allDone = deps.every(d => {
          const s = taskStepStore.get(d)
          return s?.status === 'done'
        })
        if (allDone) {
          taskStepStore.updateStatus(depId, 'ready')
          unlockedSteps.push(depId)
        }
      }
    }

    let taskCompleted = false
    if (input.agentStatus === 'done' && task.status === 'running') {
      const all = taskStepStore.listByTask(input.taskId)
      const allDone = all.length > 0 && all.every(s => s.status === 'done')
      if (allDone) {
        taskStore.updateStatus(input.taskId, 'completed', '所有步骤已完成')
        taskCompleted = true
        const t = taskStore.get(input.taskId)
        if (t) {
          events.emit('task:update', { taskId: input.taskId, data: { ...t, event: 'completed' } })
          emitTaskLifecycleEvent(t, 'status_changed', 'running')
        }
      }
    }

    if (input.agentStatus === 'blocked' && task.status === 'running') {
      taskStore.updateStatus(input.taskId, 'needs_input', `步骤 ${step.title} 卡住,等待人工决策`)
      const t = taskStore.get(input.taskId)
      if (t) {
        events.emit('task:update', { taskId: input.taskId, data: { ...t, event: 'step_blocked' } })
        emitTaskLifecycleEvent(t, 'status_changed', 'running')
      }
    } else if (input.agentStatus === 'milestone' && previousStatus === 'blocked' && task.status === 'needs_input') {
      taskStore.updateStatus(input.taskId, 'running', '步骤已恢复,任务继续')
      const t = taskStore.get(input.taskId)
      if (t) {
        events.emit('task:update', { taskId: input.taskId, data: { ...t, event: 'recovered' } })
        emitTaskLifecycleEvent(t, 'status_changed', 'needs_input')
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

  async dispatchStep(taskId: string, stepId: string): Promise<DispatchStepResult> {
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

    const session = await this.resolveStepSession(task, step)
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
    })

    log.info({ taskId, stepId, sessionId: session.id, reuse: session.reuse }, 'step dispatched')
    return { stepId, sessionId: session.id, reused: session.reuse }
  },

  async resolveStepSession(task: TaskRow, step: TaskStepRow): Promise<{ id: string; reuse: boolean }> {
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
    for (const step of all) {
      if (step.status === 'pending') {
        const deps = taskStepStore.listDependencies(step.id)
        const allDone = deps.every(d => taskStepStore.get(d)?.status === 'done')
        if (allDone) {
          if (step.assignee_agent_id) {
            taskStepStore.updateStatus(step.id, 'ready')
          } else {
            taskStepStore.updateStatus(step.id, 'ready')
          }
        }
      }
    }

    const readyCandidates = all.filter(s => s.status === 'ready' || (s.status === 'pending' && (taskStepStore.listDependencies(s.id).every(d => taskStepStore.get(d)?.status === 'done'))))
    const dispatched: string[] = []
    for (const step of readyCandidates) {
      if (step.status !== 'ready') {
        taskStepStore.updateStatus(step.id, 'ready')
      }
      if (!step.assignee_agent_id) continue
      try {
        await this.dispatchStep(taskId, step.id)
        dispatched.push(step.id)
      } catch (err) {
        log.warn({ err, taskId, stepId: step.id }, 'failed to dispatch step on start')
      }
    }

    const updated = taskStore.get(taskId)!
    if (previousStatus !== 'running') {
      emitTaskLifecycleEvent(updated, 'status_changed', previousStatus)
    }
    events.emit('task:update', { taskId, data: { ...updated, event: 'started', dispatched } })
    log.info({ taskId, previousStatus, dispatched }, 'task started')
    return { task: updated, dispatched }
  },

  buildStepView(taskId: string, stepId: string): StepView | null {
    const step = taskStepStore.get(stepId)
    if (!step || step.task_id !== taskId) return null
    const deps = taskStepStore.listDependencies(stepId)
    const reportRows = getStepReports(taskId, stepId)
    const reports = reportRows.map(row => {
      const payload = parsePayload(row.payload_json)
      return {
        agentStatus: typeof payload.agentStatus === 'string' ? payload.agentStatus : '',
        reportMd: typeof payload.reportMd === 'string' ? payload.reportMd : null,
        artifacts: Array.isArray(payload.artifacts) ? payload.artifacts as StepArtifact[] : undefined,
        agentId: typeof payload.agentId === 'string' ? payload.agentId : '',
        sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : '',
        time: row.created_at,
      }
    })
    return {
      id: step.id,
      title: step.title,
      description: step.description,
      status: step.status,
      assignee: step.assignee_agent_id,
      sessionId: step.session_id,
      dependsOn: deps,
      currentStage: step.current_stage,
      reports,
    }
  },
}

export function buildStepPrompt(taskId: string, stepId: string): string {
  const task = taskStore.get(taskId)
  if (!task) throw new Error(`任务不存在: ${taskId}`)
  const step = taskStepStore.get(stepId)
  if (!step || step.task_id !== taskId) throw new Error(`步骤不存在: ${stepId}`)

  const allSteps = taskStepStore.listByTask(taskId)
  const myIndex = allSteps.findIndex(s => s.id === stepId)
  const snapshotLines = allSteps.map((s, idx) => {
    const me = s.id === stepId
    const mark = me ? ' ← 你在这里' : ''
    return `${idx + 1}. ${s.title} [${describeStepStatusForPrompt(s, me)}]${mark}`
  })

  const upstreamDeps = taskStepStore.listDependencies(stepId)
  const upstreamSections: string[] = []
  for (const upId of upstreamDeps) {
    const up = taskStepStore.get(upId)
    if (!up) continue
    const reports = getStepReports(taskId, upId)
    const latest = reports[reports.length - 1]
    if (!latest) {
      upstreamSections.push(`- 上游步骤 #${upId} ${up.title}: (无汇报)`)
      continue
    }
    const payload = parsePayload(latest.payload_json)
    const md = typeof payload.reportMd === 'string' ? payload.reportMd : ''
    const preview = md.slice(0, 200)
    const artifacts = Array.isArray(payload.artifacts)
      ? (payload.artifacts as StepArtifact[]).map(a => `${a.type}:${a.value}`).join(', ')
      : '无'
    upstreamSections.push(`- 上游步骤 #${upId} ${up.title}: ${preview || '(无报告)'}\n  artifacts: ${artifacts}`)
  }

  const parts: string[] = []
  parts.push('你是被步骤派发唤醒的 Agent。\n')
  parts.push(`【任务】#${taskId} ${task.title}`)
  parts.push(task.description || '(无任务目标文档)')
  parts.push('')
  parts.push('【步骤图当前状态】')
  parts.push(snapshotLines.join('\n'))
  parts.push('')
  parts.push(`【你的步骤】#${stepId} ${step.title}`)
  parts.push(step.description || '(无步骤说明)')
  parts.push(`当前进度:${step.current_stage || '尚未开始'}`)
  if (upstreamSections.length > 0) {
    parts.push('')
    parts.push('【上游产出摘要】')
    parts.push(upstreamSections.join('\n'))
    parts.push('(可调 task.step.get(taskId, stepId) 拉完整报告)')
  }
  parts.push('')
  parts.push('【可用工具】')
  parts.push(`- task.step.updateProgress(taskId, stepId, stage) —— 更新一句话进度`)
  parts.push(`- task.step.report(taskId, stepId, agentStatus, reportMd, artifacts?) —— 汇报(milestone/blocked/done)`)
  parts.push(`- task.get(taskId) —— 看任务全貌`)
  parts.push(`- task.step.get(taskId, stepId) —— 看任意步骤详情(含上游产出)`)
  parts.push('')
  parts.push('【执行要求】')
  parts.push(`1. 每次调用工具必须带 taskId=${taskId} 和 stepId=${stepId}`)
  parts.push('2. 关键节点用 report(milestone),完成用 report(done),卡住用 report(blocked)')
  parts.push('3. report 的 reportMd 要写完整:做了什么/改动详情/验证结果/下一步')
  parts.push('4. 任务在 draft 状态时 report 不解锁下游,需 PM task.start 后才继续')

  return parts.join('\n')
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
