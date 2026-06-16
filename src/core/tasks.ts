import { taskStore, type CreateTaskInput } from '../store/tasks.js'
import { agentStore } from '../store/agents.js'
import { sessionStore } from '../store/sessions.js'
import { sessionManager } from './sessions.js'
import { events } from './events.js'
import { emitTaskLifecycleEvent } from './task-lifecycle-events.js'
import { createChildLogger } from './logger.js'

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
        sessionManager.enqueuePrompt(session.id, prompt).catch((err) => {
          log.error({ err, taskId: task.id, sessionId: session.id }, '任务 prompt 发送失败')
          taskStore.updateStatus(task.id, 'blocked', `执行失败: ${(err as Error).message}`)
          events.emit('task:update', {
            taskId: task.id,
            data: { status: 'blocked', stage: `执行失败: ${(err as Error).message}` },
          })
          emitTaskLifecycleEvent(taskStore.get(task.id)!, 'prompt_failed', 'executing')
        })

        const updated = taskStore.get(task.id)!
        return { ...updated, sessionId: session.id }
      } catch (err) {
        log.error({ err, taskId: task.id, agentId: input.assignAgentId }, '任务分派失败')
        taskStore.updateStatus(task.id, 'blocked', `分派失败: ${(err as Error).message}`)
        events.emit('task:update', {
          taskId: task.id,
          data: { status: 'blocked', stage: `分派失败: ${(err as Error).message}` },
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
      sessionManager.enqueuePrompt(session.id, prompt).catch((err: Error) => {
        log.error({ err, taskId: input.taskId, sessionId: session.id }, 'Task prompt failed')
        taskStore.updateStatus(input.taskId, 'blocked', `Execution failed: ${err.message}`)
        const failed = taskStore.get(input.taskId)!
        events.emit('task:update', { taskId: input.taskId, data: { ...failed, event: 'prompt_failed' } })
        emitTaskLifecycleEvent(failed, 'prompt_failed', 'executing')
      })

      return { ...updated, sessionId: session.id }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      taskStore.updateStatus(input.taskId, 'blocked', `分派失败: ${message}`)
      const failed = taskStore.get(input.taskId)!
      events.emit('task:update', { taskId: input.taskId, data: { ...failed, event: 'assign_failed' } })
      emitTaskLifecycleEvent(failed, 'assign_failed', previousStatus)
      throw err
    }
  },

  updateTask(taskId: string, status?: string, stage?: string, changeType?: string) {
    const task = taskStore.get(taskId)
    if (!task) throw new Error(`Task 不存在: ${taskId}`)

    if (status) {
      taskStore.updateStatus(taskId, status, stage)
      log.info({ taskId, status, stage }, '任务状态变更')
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
   - 用途：汇报当前工作进度
   - 时机：每完成一个阶段、开始新的步骤时调用
   - 示例：studio.task.update_progress("${task.id}", "正在分析代码结构")
   - 特殊：如果任务处于「待确认」或「已阻塞」状态，调用此工具会自动恢复为「执行中」

2. studio.task.request_input(taskId, question)
   - 用途：遇到需要用户决策的问题时，暂停并请求输入
   - 时机：有多个方案需要选择、需要确认方向、缺少关键信息时
   - 效果：任务状态变为「待确认」，用户会在任务面板中看到你的问题
   - 示例：studio.task.request_input("${task.id}", "发现两种方案：A=JWT B=Session，请选择")

3. studio.task.mark_blocked(taskId, reason)
   - 用途：遇到自己无法解决的障碍时上报
   - 时机：缺少权限、依赖未安装、需要外部操作等
   - 效果：任务状态变为「已阻塞」，用户会看到阻塞原因
   - 示例：studio.task.mark_blocked("${task.id}", "缺少数据库写入权限，请授权后告知")

4. studio.task.mark_done(taskId, summary)
   - 用途：任务全部完成后，通知用户审查
   - 时机：所有工作完成、确认无误后调用（只调用一次）
   - 效果：任务状态变为「审查中」，等待用户确认
   - 示例：studio.task.mark_done("${task.id}", "已完成登录模块重构，改为 JWT 方案，涉及 5 个文件")

━━━ 执行要求 ━━━
1. 开始工作前，先调用 studio.task.update_progress 标记 "开始执行"
2. 执行过程中，每完成一个关键步骤都调用 studio.task.update_progress 更新进度
3. 遇到不确定的决策点，调用 studio.task.request_input 请求用户输入，不要自行猜测
4. 遇到无法解决的问题，调用 studio.task.mark_blocked 上报，不要跳过或忽略
5. 全部完成后，调用 studio.task.mark_done 并附上工作总结
6. 不要在没有调用 mark_done 的情况下就结束对话

请现在开始执行任务。`)

  return parts.join('\n')
}
