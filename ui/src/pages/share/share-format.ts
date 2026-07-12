import type { ShareRow } from '../../services/share-api'

export type ShareStatus = 'active' | 'expired' | 'revoked'

export function computeStatus(share: ShareRow, nowTick: number): ShareStatus {
  if (share.revoked_at) return 'revoked'
  if (share.expires_at && new Date(share.expires_at).getTime() < nowTick) return 'expired'
  return 'active'
}

export function formatExpiresAt(expiresAt: string | null): string {
  if (!expiresAt) return '永久'
  const d = new Date(expiresAt)
  const diff = d.getTime() - Date.now()
  if (diff <= 0) return '已过期'
  const days = Math.floor(diff / (24 * 60 * 60 * 1000))
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h`
  const minutes = Math.floor(diff / (60 * 1000))
  return `${minutes}m`
}

export function formatLastVisited(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} 分钟前`
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))} 小时前`
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / (24 * 60 * 60 * 1000))} 天前`
  return new Date(iso).toLocaleDateString('zh-CN')
}
