import { existsSync, statSync } from 'fs'
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
      color: msg.color as string | undefined,
      icon: msg.icon as string | undefined,
    }))
  },

  'projects.update'(msg, { sendResult }) {
    const fields: Record<string, unknown> = {}
    if (msg.name !== undefined) fields.name = msg.name
    if (msg.workDir !== undefined) fields.work_dir = msg.workDir
    if (msg.description !== undefined) fields.description = msg.description
    if (msg.color !== undefined) fields.color = msg.color
    if (msg.icon !== undefined) fields.icon = msg.icon
    sendResult(projectStore.update(msg.projectId as string, fields as never))
  },

  'projects.select'(msg, { sendResult }) {
    const updated = projectStore.touchVisit(msg.projectId as string)
    sendResult(updated)
  },

  'projects.delete'(msg, { sendResult }) {
    projectStore.delete(msg.projectId as string)
    sendResult({ deleted: true })
  },

  'projects.check_path'(msg, { sendResult }) {
    const path = msg.path as string
    if (!path || typeof path !== 'string') {
      sendResult({ exists: false, isDir: false })
      return
    }
    try {
      const exists = existsSync(path)
      const isDir = exists ? statSync(path).isDirectory() : false
      sendResult({ exists, isDir })
    } catch {
      sendResult({ exists: false, isDir: false })
    }
  },
}
