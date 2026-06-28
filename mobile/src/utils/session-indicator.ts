import type { MobileSessionItem } from '../stores/session.store'

type MobileSessionIndicatorInput = Pick<MobileSessionItem, 'activityState' | 'unread' | 'status'>

export interface MobileSessionIndicator {
  color: string
  pulse: boolean
  title: string
  label: string
}

const STATUS_LABELS: Record<string, string> = {
  active: '可用',
  closed: '已关闭',
  completed: '已完成',
  cancelled: '已取消',
  failed: '失败',
}

export function mobileSessionIndicator(session: MobileSessionIndicatorInput): MobileSessionIndicator {
  if (session.activityState === 'running') {
    return { color: 'var(--success)', pulse: true, title: '正在执行', label: '执行中' }
  }
  if (session.unread) {
    return { color: 'var(--warning)', pulse: false, title: '有新回复', label: '有新回复' }
  }
  if (session.status === 'active') {
    return { color: 'var(--success)', pulse: false, title: '可用', label: '可用' }
  }
  const label = STATUS_LABELS[session.status] || session.status || '已关闭'
  return { color: 'var(--text-muted)', pulse: false, title: label, label }
}
