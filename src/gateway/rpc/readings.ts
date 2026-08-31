import { loadConfig } from '../../core/config.js'
import {
  readingItemStore,
  type ReadingItemListRow,
  type ReadingItemStatus,
} from '../../store/reading-items.js'
import type { RpcHandlerMap } from './types.js'

export interface ReadingItemDto {
  id: string
  projectId: string | null
  projectName: string | null
  projectColor: string | null
  sessionId: string | null
  sessionTitle: string | null
  agentId: string | null
  agentName: string | null
  agentIcon: string | null
  title: string
  summary: string
  format: 'md' | 'html' | 'url'
  status: ReadingItemStatus
  createdAt: string
  updatedAt: string
  readAt: string | null
  archivedAt: string | null
  contentUrl: string | null
  externalUrl: string | null
}

export const readingRpcHandlers: RpcHandlerMap = {
  'reading.list'(msg, context) {
    if (!requireOwner(context.state.authMode, context.sendError)) return
    const status = msg.status === 'archived' ? 'archived' : 'active'
    const projectId = msg.projectId === null
      ? null
      : typeof msg.projectId === 'string' && msg.projectId.trim()
        ? msg.projectId.trim()
        : undefined
    const query = typeof msg.query === 'string' ? msg.query : undefined
    const limit = numberField(msg.limit, 100, 1, 200)
    const offset = numberField(msg.offset, 0, 0, Number.MAX_SAFE_INTEGER)
    context.sendResult({
      items: readingItemStore.list({ status, projectId, query, limit, offset }).map(toDto),
      unreadCount: readingItemStore.countUnread(),
      projectCounts: readingItemStore.countByProject(status).map((entry) => ({
        projectId: entry.project_id,
        projectName: entry.project_name,
        projectColor: entry.project_color,
        count: entry.count,
      })),
    })
  },

  'reading.get'(msg, context) {
    if (!requireOwner(context.state.authMode, context.sendError)) return
    const readingId = stringField(msg.readingId)
    if (!readingId) return context.sendError('readingId 不能为空')
    const item = readingItemStore.getDetail(readingId)
    if (!item) return context.sendError('阅读条目不存在')
    context.sendResult({ item: toDto(item) })
  },

  'reading.update'(msg, context) {
    if (!requireOwner(context.state.authMode, context.sendError)) return
    const readingId = stringField(msg.readingId)
    if (!readingId) return context.sendError('readingId 不能为空')
    const status = msg.status === 'read' || msg.status === 'archived' ? msg.status : null
    if (!status) return context.sendError('status 必须是 read 或 archived')
    const updated = readingItemStore.updateStatus(readingId, status)
    if (!updated) return context.sendError('阅读条目不存在')
    const detail = readingItemStore.getDetail(readingId)
    if (!detail) return context.sendError('阅读条目不存在')
    context.sendResult({ item: toDto(detail) })
  },
}

function toDto(row: ReadingItemListRow): ReadingItemDto {
  const config = loadConfig()
  const token = config.localToken ? `?token=${encodeURIComponent(config.localToken)}` : ''
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    projectColor: row.project_color,
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    agentId: row.agent_id,
    agentName: row.agent_name,
    agentIcon: row.agent_icon,
    title: row.title,
    summary: row.summary,
    format: row.format,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readAt: row.read_at,
    archivedAt: row.archived_at,
    contentUrl: row.format === 'url' ? null : `/reading/${row.id}/${token}`,
    externalUrl: row.format === 'url' ? row.url : null,
  }
}

function requireOwner(authMode: string, sendError: (message: string) => void): boolean {
  if (authMode === 'owner') return true
  sendError('阅读功能仅限所有者使用')
  return false
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberField(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}
