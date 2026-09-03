import { getStoredAccessToken } from '../stores/connection.store'

/**
 * 构造带鉴权 token 的预览 URL：/preview/{id}/?token=...
 *
 * 预览 cookie 是 per-previewId 的（Path=/preview/{previewId}/），iframe 首次加载
 * 该 previewId 时没有任何 cookie，裸 URL 必然 401「未授权」。必须像
 * preview.publish 工具输出那样把 localToken 拼进 URL（首访后服务端会 Set-Cookie）。
 *
 * token 优先级：显式传入 > 当前页面 URL query > localStorage 存储的 access token。
 */
export function buildPreviewUrl(previewId: string, tokenOverride?: string): string {
  const pageToken = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('token')
    : null
  const token = (tokenOverride ?? pageToken ?? getStoredAccessToken()).trim()
  const query = token ? `?token=${encodeURIComponent(token)}` : ''
  return `/preview/${previewId}/${query}`
}
