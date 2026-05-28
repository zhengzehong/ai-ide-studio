import { expandDirectory, listDirectory, readFile } from '../../core/filesystem.js'
import { projectStore } from '../../store/projects.js'
import type { RpcHandlerMap } from './types.js'

export const filesystemRpcHandlers: RpcHandlerMap = {
  'fs.list'(msg, { sendResult }) {
    const project = projectStore.get(msg.projectId as string)
    if (!project) throw new Error('项目不存在')
    const entries = msg.dirPath
      ? expandDirectory(project.work_dir, msg.dirPath as string)
      : listDirectory(project.work_dir)
    sendResult(entries)
  },

  'fs.read'(msg, { sendResult }) {
    const project = projectStore.get(msg.projectId as string)
    if (!project) throw new Error('项目不存在')
    const fileContent = readFile(project.work_dir, msg.filePath as string)
    if (!fileContent) throw new Error('文件不存在或无法读取')
    sendResult(fileContent)
  },
}
