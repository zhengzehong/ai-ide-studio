import { taskManager } from '../../core/tasks.js'
import { taskStore } from '../../store/tasks.js'
import type { RpcHandlerMap } from './types.js'

export const taskRpcHandlers: RpcHandlerMap = {
  'tasks.list'(msg, { sendResult }) {
    sendResult(taskStore.list(msg.status as string | undefined, msg.projectId as string | undefined))
  },

  async 'tasks.create'(msg, { sendResult }) {
    const task = await taskManager.createTask({
      title: msg.title as string,
      description: msg.description as string | undefined,
      assignAgentId: msg.assignAgentId as string | undefined,
      projectId: msg.projectId as string | undefined,
    })
    sendResult(task)
  },

  'tasks.update'(msg, { sendResult }) {
    taskManager.updateTask(msg.taskId as string, msg.status as string | undefined, msg.stage as string | undefined)
    sendResult(taskStore.get(msg.taskId as string))
  },
}
