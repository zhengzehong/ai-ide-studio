import { taskStore, type CreateTaskInput } from '../store/tasks.js'
import { agentStore } from '../store/agents.js'
import { sessionManager } from './sessions.js'
import { events } from './events.js'

export const taskManager = {
  async createTask(input: CreateTaskInput) {
    const task = taskStore.create(input)

    events.emit('task:update', {
      taskId: task.id,
      data: { ...task, event: 'created' },
    })

    if (input.assignAgentId) {
      const agent = agentStore.get(input.assignAgentId)
      if (!agent) throw new Error(`Agent 不存在: ${input.assignAgentId}`)

      try {
        const session = await sessionManager.createSession(input.assignAgentId, task.id)

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

        const prompt = buildTaskPrompt(task.title, task.description)
        sessionManager.sendPrompt(session.id, prompt).catch((err) => {
          console.error(`[Task] 任务 ${task.id} prompt 失败:`, err)
          taskStore.updateStatus(task.id, 'blocked', `执行失败: ${(err as Error).message}`)
          events.emit('task:update', {
            taskId: task.id,
            data: { status: 'blocked', stage: `执行失败: ${(err as Error).message}` },
          })
        })

        const updated = taskStore.get(task.id)!
        return { ...updated, sessionId: session.id }
      } catch (err) {
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
    }

    const updated = taskStore.get(taskId)!
    events.emit('task:update', {
      taskId,
      data: { ...updated, event: 'updated' },
    })

    return updated
  },
}

function buildTaskPrompt(title: string, description?: string): string {
  let prompt = `你被分派了一个任务：${title}`
  if (description) {
    prompt += `\n\n任务描述：${description}`
  }
  prompt += '\n\n请开始工作。'
  return prompt
}
