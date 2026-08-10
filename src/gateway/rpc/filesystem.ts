import { expandDirectory, inspectFile, listDirectory, readFile, resolveFileReference } from '../../core/filesystem.js'
import { projectStore } from '../../store/projects.js'
import { createFileAssetUrl } from '../file-asset-signing.js'
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

  'fs.assetUrl'(msg, { state, sendResult }) {
    if (state.authMode !== 'owner') throw new Error('无权访问项目文件')
    const projectId = typeof msg.projectId === 'string' ? msg.projectId : ''
    const filePath = typeof msg.filePath === 'string' ? msg.filePath : ''
    const basePath = typeof msg.basePath === 'string' ? msg.basePath : undefined
    const mode = msg.mode === 'attachment' ? 'attachment' : 'inline'
    const project = projectStore.get(projectId)
    if (!project) throw new Error('项目不存在')
    const resolvedPath = resolveFileReference(project.work_dir, filePath, basePath)
    const file = resolvedPath ? inspectFile(project.work_dir, resolvedPath) : null
    if (!file) throw new Error('文件不存在或无法读取')
    sendResult({
      ...createFileAssetUrl({ projectId, path: file.path, mode }),
      path: file.path,
      kind: file.kind,
    })
  },
}

