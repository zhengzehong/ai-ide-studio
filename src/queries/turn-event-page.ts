import type { SessionEventRow } from '../store/sessions.js'

export interface TurnEventPage { items: SessionEventRow[]; nextSequence: number; hasMore: boolean }
/** 单页预算:条目上限与序列化字节上限。默认值即历史行为(PC 端不变)。 */
export interface TurnEventPageBudget { maxItems: number; maxBytes: number }

export const DEFAULT_TURN_EVENT_PAGE_BUDGET: TurnEventPageBudget = { maxItems: 100, maxBytes: 128 * 1024 }
/** 服务端兜底上限:客户端可申请更大分页(移动端单帧放宽),但不得突破该上限。 */
export const MAX_TURN_EVENT_PAGE_BUDGET: TurnEventPageBudget = { maxItems: 1000, maxBytes: 1024 * 1024 }
const MAX_SINGLE_EVENT_BYTES = 1024 * 1024

/** 把客户端申请的预算收敛到 [默认值, 上限] 区间;未提供或非法值回落默认。 */
export function resolveTurnEventPageBudget(requested: Partial<TurnEventPageBudget> = {}): TurnEventPageBudget {
  return {
    maxItems: clampBudget(requested.maxItems, DEFAULT_TURN_EVENT_PAGE_BUDGET.maxItems, MAX_TURN_EVENT_PAGE_BUDGET.maxItems),
    maxBytes: clampBudget(requested.maxBytes, DEFAULT_TURN_EVENT_PAGE_BUDGET.maxBytes, MAX_TURN_EVENT_PAGE_BUDGET.maxBytes),
  }
}

function clampBudget(value: number | undefined, fallback: number, cap: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), cap)
}

export function pageTurnEvents(rows: SessionEventRow[], afterSequence: number, throughSequence: number, budget: TurnEventPageBudget = DEFAULT_TURN_EVENT_PAGE_BUDGET): TurnEventPage {
  const eligible = rows.filter(row => row.sequence > afterSequence && row.sequence <= throughSequence)
  const items: SessionEventRow[] = []
  let bytes = 0
  for (const row of eligible) {
    const size = Buffer.byteLength(JSON.stringify(row))
    if (size > MAX_SINGLE_EVENT_BYTES) throw new Error('单条执行事件过大，无法恢复，请查看已保存的消息')
    if (items.length && (items.length >= budget.maxItems || bytes + size > budget.maxBytes)) break
    items.push(row)
    bytes += size
  }
  return { items, nextSequence: items.at(-1)?.sequence ?? afterSequence, hasMore: items.length < eligible.length }
}
