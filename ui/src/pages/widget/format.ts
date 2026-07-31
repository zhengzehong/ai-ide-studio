export function formatTimeAgo(time: string): string {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(time).getTime()) / 1000))
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟`
  if (diff < 86_400) return `${Math.floor(diff / 3600)} 小时`
  return `${Math.floor(diff / 86_400)} 天`
}
