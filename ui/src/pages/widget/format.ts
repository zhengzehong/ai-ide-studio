export function formatElapsed(startedAt: string): string {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
  const mins = Math.floor(diff / 60)
  const secs = diff % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function formatTimeAgo(time: string): string {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(time).getTime()) / 1000))
  if (diff < 60) return `${diff}s前`
  if (diff < 3600) return `${Math.floor(diff / 60)}m前`
  return `${Math.floor(diff / 3600)}h前`
}

export function taskStatusMeta(status: string): { label: string; color: string; active: boolean; filled: boolean } {
  if (status === 'running') return { label: '执行中', color: '#2563eb', active: true, filled: false }
  if (status === 'needs_input') return { label: '待确认', color: '#d97706', active: true, filled: false }
  if (status === 'completed') return { label: '已完成', color: '#16a34a', active: false, filled: true }
  if (status === 'cancelled') return { label: '已取消', color: '#9ca3af', active: false, filled: false }
  return { label: '待办', color: '#9ca3af', active: false, filled: false }
}
