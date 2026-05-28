import { projectStore } from '../../store/projects.js'
import type { RpcHandlerMap } from './types.js'

export const projectRpcHandlers: RpcHandlerMap = {
  'projects.list'(_msg, { sendResult }) {
    sendResult(projectStore.list())
  },

  'projects.create'(msg, { sendResult }) {
    sendResult(projectStore.create({
      name: msg.name as string,
      workDir: msg.workDir as string,
      description: msg.description as string | undefined,
    }))
  },

  'projects.update'(msg, { sendResult }) {
    const fields: Record<string, unknown> = {}
    if (msg.name !== undefined) fields.name = msg.name
    if (msg.workDir !== undefined) fields.work_dir = msg.workDir
    if (msg.description !== undefined) fields.description = msg.description
    sendResult(projectStore.update(msg.projectId as string, fields as never))
  },

  'projects.delete'(msg, { sendResult }) {
    projectStore.delete(msg.projectId as string)
    sendResult({ deleted: true })
  },
}
