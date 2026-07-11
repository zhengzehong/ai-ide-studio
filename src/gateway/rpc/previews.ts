import { previewStore, type PreviewRow } from '../../store/previews.js'
import { loadConfig } from '../../core/config.js'
import type { RpcHandlerMap } from './types.js'

interface PreviewDto {
  id: string
  projectId: string
  title: string
  sourcePath: string
  entryFile: string
  target: 'pc' | 'app'
  taskId: string | null
  description: string | null
  createdByAgentId: string | null
  createdAt: string
  url: string
}

function buildPreviewUrl(preview: PreviewRow): string {
  const config = loadConfig()
  const token = config.localToken ? `?token=${encodeURIComponent(config.localToken)}` : ''
  return `/preview/${preview.id}/${token}`
}

function toDto(preview: PreviewRow): PreviewDto {
  return {
    id: preview.id,
    projectId: preview.project_id,
    title: preview.title,
    sourcePath: preview.source_path,
    entryFile: preview.entry_file,
    target: preview.target,
    taskId: preview.task_id,
    description: preview.description,
    createdByAgentId: preview.created_by_agent_id,
    createdAt: preview.created_at,
    url: buildPreviewUrl(preview),
  }
}

export const previewRpcHandlers: RpcHandlerMap = {
  'previews.list'(msg, { sendResult }) {
    const projectId = typeof msg.projectId === 'string' && msg.projectId.trim() ? msg.projectId : undefined
    const taskId = typeof msg.taskId === 'string' && msg.taskId.trim() ? msg.taskId : undefined
    const previews = previewStore.list(projectId, taskId).map(toDto)
    sendResult({ previews })
  },

  'previews.get'(msg, { sendResult, sendError }) {
    const previewId = msg.previewId as string | undefined
    if (!previewId) return sendError('previewId 不能为空')
    const preview = previewStore.get(previewId)
    if (!preview) return sendError('预览不存在')
    sendResult({ preview: toDto(preview) })
  },

  'previews.delete'(msg, { sendResult, sendError }) {
    const previewId = msg.previewId as string | undefined
    if (!previewId) return sendError('previewId 不能为空')
    const preview = previewStore.get(previewId)
    if (!preview) return sendError('预览不存在')
    previewStore.delete(previewId)
    sendResult({ deleted: true })
  },
}
