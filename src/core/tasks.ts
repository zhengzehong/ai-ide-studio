import { taskAttachmentStore, taskStore, taskEventStore, type CreateTaskInput, type TaskAttachmentRow } from '../store/tasks.js'
import { agentStore } from '../store/agents.js'
import { sessionStore } from '../store/sessions.js'
import { sessionManager } from './sessions.js'
import { events } from './events.js'
import { emitTaskLifecycleEvent } from './task-lifecycle-events.js'
import { createChildLogger } from './logger.js'
import { appendHiddenAttachmentNote, loadStoredImagesForAcp, saveTaskImages, type StoredImageAttachment } from './image-attachments.js'

const log = createChildLogger('task')

export type AgentSessionMode = 'existing' | 'new_each' | 'new_fixed'

export interface AssignTaskInput {
  taskId: string
  agentId: string
  sessionId?: string
  sessionMode?: AgentSessionMode
  promptTemplate?: string
  ruleName?: string
}

export const taskManager = {
  async createTask(input: CreateTaskInput) {
    if (!input.title?.trim()) throw new Error('任务标题不能为空')
    const sessionMode = resolveSessionMode(input.sessionMode, input.sessionId)
    validateSessionModeTarget(sessionMode, input.sessionId)
    validateTaskAssignment(
      input.assignAgentId,
      input.projectId,
      sessionMode === 'existing' || (sessionMode === 'new_fixed' && input.sessionId) ? input.sessionId : undefined,
    )
    const task = taskStore.create(input)
    const savedImages = await saveTaskImages({
      projectId: input.projectId,
      taskId: task.id,
      images: input.images,
    })
    if (savedImages.length > 0) taskAttachmentStore.replace(task.id, savedImages)
    log.info({ taskId: task.id, title: task.title, agentId: input.assignAgentId }, '任务已创建')

    events.emit('task:update', {
      taskId: task.id,
      data: { ...task, event: 'created' },
    })
    emitTaskLifecycleEvent(task, 'created', null)

    if (input.assignAgentId) {
      try {
        const session = await resolveTaskSession({
          agentId: input.assignAgentId,
          projectId: input.projectId,
          taskId: task.id,
          sessionId: input.sessionId,
          sessionMode,
        })
        const sessionReuse = session.reuse
        log.info({ taskId: task.id, sessionId: session.id, agentId: input.assignAgentId, reuse: sessionReuse }, '任务已分派')

        taskStore.updateStatus(task.id, 'executing', '已分派给 Agent')
        taskStore.linkSession(task.id, session.id)

        events.emit('task:update', {
          taskId: task.id,
          data: {
            status: 'executing',
            stage: '已分派给 Agent',
            sessionId: session.id,
            assignedAgentId: input.assignAgentId,
          },
        })
        emitTaskLifecycleEvent(taskStore.get(task.id)!, 'assigned', task.status)

        const prompt = input.promptTemplate || buildTaskPrompt(
          { id: task.id, title: task.title, description: task.description, source: task.source },
          { sessionReuse, ruleName: input.ruleName },
        )
        const promptWithAttachments = appendHiddenAttachmentNote(prompt, savedImages)
        const promptImages = savedImages.length > 0 ? await loadStoredImagesForAcp(savedImages) : undefined
        const queued = promptImages
          ? sessionManager.enqueuePrompt(session.id, promptWithAttachments, promptImages)
          : sessionManager.enqueuePrompt(session.id, promptWithAttachments)
        queued.catch((err) => {
          log.error({ err, taskId: task.id, sessionId: session.id }, '任务 prompt 发送失败')
          taskStore.updateStatus(task.id, 'needs_input', `执行失败: ${(err as Error).message}`)
          events.emit('task:update', {
            taskId: task.id,
            data: { status: 'needs_input', stage: `执行失败: ${(err as Error).message}` },
          })
          emitTaskLifecycleEvent(taskStore.get(task.id)!, 'prompt_failed', 'executing')
        })

        const updated = taskStore.get(task.id)!
        return { ...updated, sessionId: session.id }
      } catch (err) {
        log.error({ err, taskId: task.id, agentId: input.assignAgentId }, '任务分派失败')
        taskStore.updateStatus(task.id, 'needs_input', `分派失败: ${(err as Error).message}`)
        events.emit('task:update', {
          taskId: task.id,
          data: { status: 'needs_input', stage: `分派失败: ${(err as Error).message}` },
        })
        emitTaskLifecycleEvent(taskStore.get(task.id)!, 'assign_failed', task.status)
        return taskStore.get(task.id)!
      }
    }

    return task
  },

  async assignTask(input: AssignTaskInput) {
    const task = taskStore.get(input.taskId)
    if (!task) throw new Error(`Task not found: ${input.taskId}`)
    if (!input.agentId) throw new Error('agentId is required')

    const sessionMode = resolveSessionMode(input.sessionMode, input.sessionId)
    validateSessionModeTarget(sessionMode, input.sessionId)
    validateTaskAssignment(
      input.agentId,
      task.project_id,
      sessionMode === 'existing' || (sessionMode === 'new_fixed' && input.sessionId) ? input.sessionId : undefined,
    )

    const previousStatus = task.status
    try {
      const session = await resolveTaskSession({
        agentId: input.agentId,
        projectId: task.project_id,
        taskId: input.taskId,
        sessionId: input.sessionId,
        sessionMode,
      })

      taskStore.assignAgent(input.taskId, input.agentId)
      taskStore.updateStatus(input.taskId, 'executing', '已分派给 Agent')
      taskStore.linkSession(input.taskId, session.id)
      const updated = taskStore.get(input.taskId)!
      log.info({ taskId: input.taskId, sessionId: session.id, agentId: input.agentId, reuse: session.reuse }, '任务已分派')

      events.emit('task:update', {
        taskId: input.taskId,
        data: { ...updated, sessionId: session.id, assignedAgentId: input.agentId, event: 'assigned' },
      })
      emitTaskLifecycleEvent(updated, 'assigned', previousStatus)

      const prompt = input.promptTemplate || buildTaskPrompt(
        { id: task.id, title: task.title, description: task.description, source: task.source },
        { sessionReuse: session.reuse, ruleName: input.ruleName },
      )
      const taskImages = toStoredImageAttachments(taskAttachmentStore.list(input.taskId))
      const promptWithAttachments = appendHiddenAttachmentNote(prompt, taskImages)
      const promptImages = taskImages.length > 0 ? await loadStoredImagesForAcp(taskImages) : undefined
      const queued = promptImages
        ? sessionManager.enqueuePrompt(session.id, promptWithAttachments, promptImages)
        : sessionManager.enqueuePrompt(session.id, promptWithAttachments)
      queued.catch((err: Error) => {
        log.error({ err, taskId: input.taskId, sessionId: session.id }, 'Task prompt failed')
        taskStore.updateStatus(input.taskId, 'needs_input', `Execution failed: ${err.message}`)
        const failed = taskStore.get(input.taskId)!
        events.emit('task:update', { taskId: input.taskId, data: { ...failed, event: 'prompt_failed' } })
        emitTaskLifecycleEvent(failed, 'prompt_failed', 'executing')
      })

      return { ...updated, sessionId: session.id }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      taskStore.updateStatus(input.taskId, 'needs_input', `分派失败: ${message}`)
      const failed = taskStore.get(input.taskId)!
      events.emit('task:update', { taskId: input.taskId, data: { ...failed, event: 'assign_failed' } })
      emitTaskLifecycleEvent(failed, 'assign_failed', previousStatus)
      throw err
    }
  },

  updateTask(taskId: string, status?: string, stage?: string, changeType?: string, reason?: string) {
    const task = taskStore.get(taskId)
    if (!task) throw new Error(`Task 不存在: ${taskId}`)

    if (status) {
      taskStore.updateStatus(taskId, status, stage)
      if (reason) {
        taskEventStore.append(taskId, { type: 'manual_status_change', payload: { from_status: task.status, to_status: status, reason } })
      }
      log.info({ taskId, status, stage, reason }, '任务状态变更')
    } else if (stage !== undefined) {
      taskStore.updateStatus(taskId, task.status, stage)
      log.info({ taskId, stage }, '任务阶段更新')
    }

    const updated = taskStore.get(taskId)!
    events.emit('task:update', {
      taskId,
      data: { ...updated, event: 'updated' },
    })
    const lifecycleChange = changeType ?? (status && status !== task.status ? 'status_changed' : 'progress_updated')
    emitTaskLifecycleEvent(updated, lifecycleChange, task.status)

    return updated
  },

  reportTask(input: { taskId: string; agentStatus: 'in_progress' | 'blocked' | 'done'; reportMd?: string; stage?: string }) {
    const task = taskStore.get(input.taskId)
    if (!task) throw new Error(`Task 不存在: ${input.taskId}`)

    const previousStatus = task.status
    let nextStatus = task.status
    if (input.agentStatus === 'in_progress') {
      if (task.status === 'needs_input') nextStatus = 'executing'
    } else if (input.agentStatus === 'blocked') {
      nextStatus = 'needs_input'
    } else if (input.agentStatus === 'done') {
      nextStatus = 'needs_input'
    }

    const stage = input.stage ?? task.stage
    if (nextStatus !== task.status) {
      taskStore.updateStatus(input.taskId, nextStatus, stage)
    } else if (input.stage !== undefined && input.stage !== task.stage) {
      taskStore.updateStatus(input.taskId, task.status, stage)
    }
    taskStore.updateAgentReportStatus(input.taskId, input.agentStatus)

    const eventType = input.agentStatus === 'in_progress' ? 'progress'
      : input.agentStatus === 'blocked' ? 'input_requested'
      : 'marked_done'
    taskEventStore.append(input.taskId, {
      type: eventType,
      payload: {
        report_md: input.reportMd ?? null,
        agent_status: input.agentStatus,
        stage,
        from_status: previousStatus,
        to_status: nextStatus,
        recovered: nextStatus !== previousStatus,
      },
    })

    const updated = taskStore.get(input.taskId)!
    const lifecycleChange = input.agentStatus === 'in_progress' ? 'progress_updated'
      : input.agentStatus === 'blocked' ? 'input_requested'
      : 'marked_done'
    log.info({ taskId: input.taskId, agentStatus: input.agentStatus, from: previousStatus, to: nextStatus }, 'Agent 汇报')
    events.emit('task:update', { taskId: input.taskId, data: { ...updated, event: 'reported' } })
    emitTaskLifecycleEvent(updated, lifecycleChange, previousStatus)

    return updated
  },

  async replyTask(input: { taskId: string; message: string }) {
    const task = taskStore.get(input.taskId)
    if (!task) throw new Error(`Task 不存在: ${input.taskId}`)
    if (task.status !== 'needs_input') throw new Error('当前任务不在待确认状态，无法回复')
    if (!input.message?.trim()) throw new Error('回复内容不能为空')

    const sessionIds = taskStore.listSessionIds(input.taskId)
    const sessionId = sessionIds.length > 0 ? sessionIds[sessionIds.length - 1] : null
    if (!task.assigned_agent_id || !sessionId) {
      throw new Error('任务未关联 Agent 会话，无法回复')
    }

    const previousStatus = task.status
    taskStore.updateStatus(input.taskId, 'executing', '人工已回复，继续执行')
    taskStore.updateAgentReportStatus(input.taskId, 'in_progress')
    taskEventStore.append(input.taskId, {
      type: 'replied',
      payload: {
        message: input.message,
        from_status: previousStatus,
        to_status: 'executing',
      },
    })

    const updated = taskStore.get(input.taskId)!
    log.info({ taskId: input.taskId, sessionId }, '人工回复任务')
    events.emit('task:update', { taskId: input.taskId, data: { ...updated, event: 'replied' } })
    emitTaskLifecycleEvent(updated, 'replied', previousStatus)

    const prompt = `[人工回复] ${input.message}\n\n请继续执行任务。`
    sessionManager.enqueuePrompt(sessionId, prompt).catch((err: Error) => {
      log.error({ err, taskId: input.taskId, sessionId }, '人工回复 prompt 发送失败')
    })

    return updated
  },
}

export { emitTaskLifecycleEvent } from './task-lifecycle-events.js'

export function resolveSessionMode(mode: unknown, sessionId?: string): AgentSessionMode {
  if (mode === 'existing' || mode === 'new_each' || mode === 'new_fixed') return mode
  return sessionId ? 'existing' : 'new_each'
}

export function validateSessionModeTarget(mode: AgentSessionMode, sessionId?: string): void {
  if (mode === 'existing' && !sessionId) throw new Error('existing session mode requires sessionId')
}

export async function resolveTaskSession(input: {
  agentId: string
  projectId?: string | null
  taskId?: string
  sessionId?: string
  sessionMode?: AgentSessionMode
}): Promise<{ id: string; reuse: boolean }> {
  const mode = input.sessionMode ?? resolveSessionMode(undefined, input.sessionId)
  validateSessionModeTarget(mode, input.sessionId)
  if (mode === 'existing') {
    const sessionId = input.sessionId
    if (!sessionId) throw new Error('existing session mode requires sessionId')
    validateTaskAssignment(input.agentId, input.projectId, sessionId)
    return { id: sessionId, reuse: true }
  }
  if (mode === 'new_fixed' && input.sessionId) {
    validateTaskAssignment(input.agentId, input.projectId, input.sessionId)
    return { id: input.sessionId, reuse: true }
  }
  const session = await sessionManager.createSession(input.agentId, input.taskId, input.projectId ?? undefined)
  return { id: session.id, reuse: false }
}

export function validateTaskAssignment(
  agentId: string | undefined,
  projectId: string | null | undefined,
  sessionId?: string,
): void {
  validateAssignedAgentProject(agentId, projectId ?? undefined)
  if (!agentId || !sessionId) return
  const session = sessionStore.get(sessionId)
  if (!session) throw new Error(`会话不存在: ${sessionId}`)
  if (session.agent_id !== agentId) throw new Error('会话不属于被指派 Agent')
  if (projectId && session.project_id !== projectId) throw new Error('会话不属于当前项目')
}

function validateAssignedAgentProject(agentId: string | undefined, projectId: string | undefined): void {
  if (!agentId) return
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`Agent not found: ${agentId}`)
  if (projectId && agent.project_id !== projectId)
    throw new Error(`Project mismatch: Agent ${agentId} is outside current project`)
}

function toStoredImageAttachments(rows: TaskAttachmentRow[]): StoredImageAttachment[] {
  return rows.map((row) => ({
    mimeType: row.mime_type,
    name: row.name ?? undefined,
    relativePath: row.relative_path,
    path: row.absolute_path,
    url: row.url,
    size: row.size,
    order: row.sort_order,
  }))
}

export function buildTaskPrompt(task: { id: string; title: string; description?: string | null; source: string }, opts?: { sessionReuse?: boolean; ruleName?: string }): string {
  const parts: string[] = []

  if (opts?.sessionReuse) {
    parts.push('[接续上下文] 以下是一个新的任务指派，请在当前对话上下文基础上执行。\n')
  }

  parts.push(`[系统提示] 这是一条由 AI IDE Studio 任务系统触发的对话。
你被分派了一个项目任务，请按照以下信息执行。

━━━ 任务信息 ━━━
任务 ID：${task.id}
任务标题：${task.title}
任务描述：${task.description || '（无）'}
来源：${task.source}（human=用户创建 / schedule=定时触发 / agent=其他Agent创建）`)

  if (opts?.ruleName) {
    parts.push(`定时规则：${opts.ruleName}`)
  }

  parts.push(`
━━━ 任务管理工具 ━━━
本次对话中你可以使用以下 AI IDE Studio 平台工具来管理任务进度。
注意：这些是平台级的项目任务管理工具，不是你自身的内部 task/todo，请区分使用。

1. studio.task.update_progress(taskId, stage)
   - 用途：轻量汇报当前阶段（一句话），更新看板卡片显示
   - 时机：每完成一个小步骤、开始新的阶段时调用
   - 参数：stage 是一句话描述，如 "正在分析代码结构"
   - 示例：studio.task.update_progress("${task.id}", "正在分析代码结构")
   - 特殊：如果任务处于「待确认」状态，调用此工具会自动恢复为「行动中」

2. studio.task.report(taskId, agentStatus, reportMd?, stage?)
   - 用途：关键节点汇报，带 Markdown 报告，并更新你的自我评估状态
   - 参数：
     * agentStatus（必填）：你当前的状态，三选一
       - in_progress：正在执行，汇报进度（任务状态保持/恢复为「行动中」）
       - blocked：遇到问题需要人工决策（任务状态变为「待确认」）
       - done：本轮工作已完成，等待人工验收（任务状态变为「待确认」）
     * reportMd（建议填）：Markdown 报告，结构建议：
       ## 本轮工作
       - 完成了什么
       ## 下一步计划
       - 接下来要做什么
       ## 问题/总结
       - blocked 时写需要确认的问题；done 时写完成总结
     * stage（可选）：一句话阶段描述
   - 示例：
     studio.task.report("${task.id}", "in_progress", "## 本轮工作\\n- 完成 JWT 中间件\\n## 下一步计划\\n- 接入 Refresh Token", "重构登录模块")
     studio.task.report("${task.id}", "blocked", "## 需要确认\\n- Token 过期策略选黑名单还是滑动续期？")
     studio.task.report("${task.id}", "done", "## 完成总结\\n- 登录模块已重构为 JWT 方案，涉及 5 个文件")

━━━ 执行要求 ━━━
1. 开始工作前，先调用 studio.task.update_progress 标记 "开始执行"
2. 执行过程中，每完成一个关键步骤都调用 studio.task.update_progress 更新阶段
3. 遇到需要决策的问题或无法解决的障碍，调用 studio.task.report(agentStatus="blocked") 并附上问题
4. 本轮工作完成后，调用 studio.task.report(agentStatus="done") 并附上完成总结
5. 被人工回复后，你会收到 [人工回复] 消息，继续执行，完成后再次 report
6. 不要在没有 report(agentStatus="done") 的情况下就结束对话

请现在开始执行任务。`)

  return parts.join('\n')
}
