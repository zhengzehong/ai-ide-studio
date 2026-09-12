import type { SessionEventRow } from '../store/sessions.js'

export interface TurnEventPage { items: SessionEventRow[]; nextSequence: number; hasMore: boolean }

export function pageTurnEvents(rows: SessionEventRow[], afterSequence: number, throughSequence: number): TurnEventPage {
  const eligible = rows.filter(row => row.sequence > afterSequence && row.sequence <= throughSequence)
  const items: SessionEventRow[] = []
  let bytes = 0
  for (const row of eligible) {
    const size = Buffer.byteLength(JSON.stringify(row))
    if (size > 1024 * 1024) throw new Error('单条执行事件过大，无法恢复，请查看已保存的消息')
    if (items.length && (items.length >= 100 || bytes + size > 128 * 1024)) break
    items.push(row)
    bytes += size
  }
  return { items, nextSequence: items.at(-1)?.sequence ?? afterSequence, hasMore: items.length < eligible.length }
}
