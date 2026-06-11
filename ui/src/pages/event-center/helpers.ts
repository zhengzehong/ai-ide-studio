import type { EventCategoryData } from '../../stores/event-center.store'

export interface EventSchemaField {
  key: string
  label: string
  type: string
  required: boolean
  placeholder: string
}

export const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: '未处理', color: 'var(--yellow)' },
  running: { label: '处理中', color: 'var(--blue)' },
  consumed: { label: '已消费', color: 'var(--green)' },
  failed: { label: '处理失败', color: 'var(--red)' },
  ignored: { label: '已忽略', color: 'var(--red)' },
  task: { label: '已转任务', color: 'var(--purple)' },
  archived: { label: '已归档', color: 'var(--text-3)' },
}

export const PRIORITY_META: Record<string, { label: string; className: string }> = {
  high: { label: '高', className: 'ec-chip ec-chip--red' },
  medium: { label: '中', className: 'ec-chip ec-chip--yellow' },
  low: { label: '低', className: 'ec-chip' },
}

export const ACTION_MODE_META: Record<string, string> = {
  create_pending: '创建待处理记录',
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function categoryName(categories: EventCategoryData[], categoryId: string): string {
  return categories.find((category) => category.id === categoryId)?.name ?? categoryId
}

export function actionModeLabel(value: string | null | undefined): string {
  return ACTION_MODE_META[value ?? ''] ?? value ?? '-'
}

export function categoryFields(category: EventCategoryData | null | undefined): EventSchemaField[] {
  const schema = parseJson<{
    properties?: Record<string, { type?: string; title?: string; description?: string }>
    required?: string[]
  }>(category?.schema_json, {})
  const required = new Set(schema.required ?? [])
  return Object.entries(schema.properties ?? {}).map(([key, config]) => ({
    key,
    label: config.title || key,
    type: config.type || 'string',
    required: required.has(key),
    placeholder: config.description || '',
  }))
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
