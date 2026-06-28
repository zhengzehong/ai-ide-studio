// Shared time-formatting helpers for task cards.
// formatRelativeTime: 用于"最近活动时间"(刚刚 / X 分钟前 / 昨天 HH:mm / X 天前 / MM/DD)
// formatDuration: 用于"已用""等待"计时(X 分钟 / X 小时 / X 天)

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const now = Date.now()
  const diff = now - t
  if (diff < 0) return '刚刚'
  if (diff < MIN) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MIN)}分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}小时前`
  const target = new Date(t)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const isYesterday =
    target.getFullYear() === yesterday.getFullYear() &&
    target.getMonth() === yesterday.getMonth() &&
    target.getDate() === yesterday.getDate()
  if (isYesterday) return `昨天 ${pad2(target.getHours())}:${pad2(target.getMinutes())}`
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}天前`
  return `${target.getMonth() + 1}/${target.getDate()}`
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < HOUR) return `${Math.max(1, Math.floor(ms / MIN))}分钟`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}小时`
  return `${Math.floor(ms / DAY)}天`
}

export function diffMsFromNow(iso: string | null | undefined): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Date.now() - t)
}
