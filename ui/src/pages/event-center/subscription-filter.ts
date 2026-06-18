import { PRIORITY_META } from './helpers'

export function readableFilter(filter: Record<string, unknown>): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []
  if (typeof filter.priority === 'string') rows.push({ label: '优先级', value: PRIORITY_META[filter.priority]?.label ?? filter.priority })
  if (typeof filter.sourceType === 'string') rows.push({ label: '来源类型', value: filter.sourceType })
  if (filter.payload && typeof filter.payload === 'object' && !Array.isArray(filter.payload)) {
    Object.entries(filter.payload as Record<string, unknown>).forEach(([key, value]) => {
      rows.push({ label: `Payload.${key}`, value: filterValueLabel(value) })
    })
  }
  return rows.length > 0 ? rows : [{ label: '条件', value: '匹配该类别的全部事件' }]
}

function filterValueLabel(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (Array.isArray(record.in)) return `in: ${record.in.map((item) => String(item)).join(', ')}`
    if (Object.prototype.hasOwnProperty.call(record, 'eq')) return `= ${String(record.eq)}`
    if (typeof record.exists === 'boolean') return record.exists ? '存在' : '不存在'
    return JSON.stringify(record)
  }
  return String(value)
}
