import type { WidgetAgentActivityState } from '../../stores/widget.store'

export type ActivityFilter = 'all' | WidgetAgentActivityState

export const ACTIVITY_FILTERS: ReadonlyArray<{ value: ActivityFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'running', label: '运行中' },
  { value: 'needs_input', label: '待处理' },
  { value: 'idle', label: '已完成' },
]

export function getNextActivityFilter(current: ActivityFilter): ActivityFilter {
  const currentIndex = ACTIVITY_FILTERS.findIndex((item) => item.value === current)
  return ACTIVITY_FILTERS[(currentIndex + 1) % ACTIVITY_FILTERS.length]?.value ?? 'all'
}

export function getActivityFilterLabel(current: ActivityFilter): string {
  return ACTIVITY_FILTERS.find((item) => item.value === current)?.label ?? ACTIVITY_FILTERS[0].label
}

