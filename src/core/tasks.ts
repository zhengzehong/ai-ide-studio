import { taskStore, type CreateTaskInput } from '../store/tasks.js'
import { agentStore } from '../store/agents.js'
import { sessionManager } from './sessions.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('task')

export const taskManager = {
  async createTask(input: CreateTaskInput) {
    validateAssignedAgentProject(input.assignAgentId, input.projectId)
    const task = taskStore.create(input)
    log.info({ taskId: task.id, title: task.title, agentId: input.assignAgentId }, '任务已创建')

    events.emit('task:update', {
      taskId: task.id,
      data: { ...task, event: 'created' },
    })

    if (input.assignAgentId) {
      try {
        const session = await sessionManager.createSession(input.assignAgentId, task.id, input.projectId)
        log.info({ taskId: task.id, sessionId: session.id, agentId: input.assignAgentId }, '任务已分派')

        taskStore.updateStatus(task.id, 'executing', '已分派给 Agent')

        events.emit('task:update', {
          taskId: task.id,
          data: {
            status: 'executing',
            stage: '已分派给 Agent',
            sessionId: session.id,
            assignedAgentId: input.assignAgentId,
          },
        })

        const prompt = buildTaskPrompt(task.title, task.description ?? undefined)
        sessionManager.sendPrompt(session.id, prompt).catch((err) => {
          log.error({ err, taskId: task.id, sessionId: session.id }, '任务 prompt 发送失败')
          taskStore.updateStatus(task.id, 'blocked', `执行失败: ${(err as Error).message}`)
          events.emit('task:update', {
            taskId: task.id,
            data: { status: 'blocked', stage: `执行失败: ${(err as Error).message}` },
          })
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
        return taskStore.get(task.id)!
      }
    }

    return task
  },

  updateTask(taskId: string, status?: string, stage?: string) {
    const task = taskStore.get(taskId)
    if (!task) throw new Error(`Task 不存在: ${taskId}`)

    if (status) {
      taskStore.updateStatus(taskId, status, stage)
      log.info({ taskId, status, stage }, '任务状态变更')
    }

    const updated = taskStore.get(taskId)!
    events.emit('task:update', {
      taskId,
      data: { ...updated, event: 'updated' },
    })

    return updated
  },
}

function validateAssignedAgentProject(agentId: string | undefined, projectId: string | undefined): void {
  if (!agentId) return
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`Agent not found: ${agentId}`)
  if (projectId && agent.project_id !== projectId)
    throw new Error(`Project mismatch: Agent ${agentId} is outside current project`)
}

function buildTaskPrompt(title: string, description?: string): string {
  let prompt = `你被分派了一个任务：${title}`
  if (description) {
    prompt += `\n\n任务描述：${description}`
  }
  prompt += '\n\n请开始工作。'
  return prompt
}
