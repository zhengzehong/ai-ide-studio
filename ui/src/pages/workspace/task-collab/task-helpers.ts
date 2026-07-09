import { CheckCircle2, Circle, ListTodo, Loader2, Zap } from 'lucide-react'
import type { TaskData } from '../../../stores/task.store'

export { isCollabTask } from './step-helpers'
export type { ParallelMarker } from './step-helpers'

export const TASK_TABS: { key: string; label: string; icon: typeof ListTodo; filter: (t: TaskData) => boolean }[] = [
  { key: 'all', label: '全部', icon: ListTodo, filter: () => true },
  { key: 'draft', label: '待办', icon: Circle, filter: (t) => t.status === 'draft' },
  {
    key: 'active',
    label: '进行中',
    icon: Loader2,
    filter: (t) => ['running', 'needs_input'].includes(t.status),
  },
  { key: 'needs_attention', label: '需处理', icon: Zap, filter: (t) => t.status === 'needs_input' },
  { key: 'done', label: '已完成', icon: CheckCircle2, filter: (t) => ['completed', 'cancelled'].includes(t.status) },
]

export const TASK_STATUS_LABEL: Record<string, string> = {
  running: '执行中',
  needs_input: '待确认',
  completed: '已完成',
  draft: '待办',
  cancelled: '已取消',
}

export const TASK_STATUS_COLOR: Record<string, string> = {
  running: '#165dff',
  needs_input: '#f53f3f',
  completed: '#00b42a',
  draft: '#ff7d00',
  cancelled: '#86909c',
}

export function taskStageLabel(s: string): string {
  return TASK_STATUS_LABEL[s] ?? s
}

export function taskStageColor(s: string): string {
  return TASK_STATUS_COLOR[s] ?? '#86909c'
}

export const AGENT_REPORT_STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  in_progress: { label: '进行中', color: '#165dff', bg: '#e8f3ff' },
  milestone: { label: '里程碑', color: '#7c3aed', bg: '#ede9fe' },
  blocked: { label: '卡住', color: '#f53f3f', bg: '#fff1f0' },
  done: { label: '已完成', color: '#00b42a', bg: '#f0f9eb' },
}

export const TASK_EVENT_TYPE_META: Record<string, { label: string; color: string; bg: string }> = {
  created: { label: '创建', color: '#86909c', bg: '#f0f1f3' },
  assigned: { label: '分派', color: '#7c3aed', bg: '#ede9fe' },
  assigned_agent: { label: '分派', color: '#7c3aed', bg: '#ede9fe' },
  self_claimed: { label: '自认领', color: '#165dff', bg: '#e8f3ff' },
  progress: { label: '进度', color: '#4e5969', bg: '#f0f1f3' },
  milestone: { label: '里程碑', color: '#7c3aed', bg: '#ede9fe' },
  input_requested: { label: '请求确认', color: '#f53f3f', bg: '#fff1f0' },
  marked_done: { label: '本轮完成', color: '#00b42a', bg: '#f0f9eb' },
  replied: { label: '人工回复', color: '#165dff', bg: '#e8f3ff' },
  status_changed: { label: '状态变更', color: '#4e5969', bg: '#f0f1f3' },
  manual_status_change: { label: '手动改状态', color: '#4e5969', bg: '#f0f1f3' },
  agent_status_changed: { label: 'Agent状态', color: '#4e5969', bg: '#f0f1f3' },
  session_linked: { label: '关联会话', color: '#4e5969', bg: '#f0f1f3' },
  updated: { label: '更新', color: '#4e5969', bg: '#f0f1f3' },
  task_started: { label: '任务启动', color: '#165dff', bg: '#e8f3ff' },
  task_reverted: { label: '回退草稿', color: '#ff7d00', bg: '#fff7e6' },
  step_added: { label: '加步骤', color: '#165dff', bg: '#e8f3ff' },
  step_updated: { label: '改步骤', color: '#165dff', bg: '#e8f3ff' },
  step_removed: { label: '删步骤', color: '#f53f3f', bg: '#fff1f0' },
  step_progress: { label: '步骤进度', color: '#4e5969', bg: '#f0f1f3' },
  step_report: { label: '步骤汇报', color: '#7c3aed', bg: '#ede9fe' },
}

export const TASK_REPORT_EVENT_TYPES = new Set([
  'progress',
  'input_requested',
  'marked_done',
  'milestone',
  'replied',
  'step_report',
])

export function parseEventPayload(json: string): Record<string, unknown> {
  try { return JSON.parse(json) as Record<string, unknown> } catch { return {} }
}

export function formatRelativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return '刚刚'
    if (mins < 60) return `${mins}分钟前`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}小时前`
    const days = Math.floor(hours / 24)
    return `${days}天前`
  } catch { return iso }
}

export function eventReportMd(ev: { payload_json: string }): string {
  const p = parseEventPayload(ev.payload_json)
  if (typeof p.reportMd === 'string' && p.reportMd) return p.reportMd
  if (typeof p.report_md === 'string' && p.report_md) return p.report_md
  if (typeof p.message === 'string' && p.message) return p.message
  return ''
}

export function eventStage(ev: { payload_json: string }): string {
  const p = parseEventPayload(ev.payload_json)
  if (typeof p.stage === 'string' && p.stage) return p.stage
  return ''
}
