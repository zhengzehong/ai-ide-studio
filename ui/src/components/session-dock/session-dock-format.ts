import { buildProjectPath } from '../../routing/project-routes'

export function sessionDockTitle(title: string | null, sessionId: string): string {
  return title?.trim() || `会话 ${sessionId.slice(-6)}`
}

export function sessionDockWorkspacePath(projectId: string, sessionId: string): string {
  return buildProjectPath(projectId, {
    pathname: '/workspace',
    search: `?sessionId=${encodeURIComponent(sessionId)}`,
    hash: '',
  })
}

export function formatSessionDockTime(time: string, now = Date.now()): string {
  const parsed = Date.parse(time)
  if (!Number.isFinite(parsed)) return ''
  const diff = Math.max(0, Math.floor((now - parsed) / 1000))
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86_400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 7 * 86_400) return `${Math.floor(diff / 86_400)} 天前`
  return new Date(parsed).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
