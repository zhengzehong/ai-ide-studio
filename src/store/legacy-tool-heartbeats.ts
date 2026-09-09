import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('legacy-tool-heartbeats')
interface HistoryToolRow {
  id: string
  kind: string
  title: string | null
  detail_json: string | null
  meta_json: string | null
}

/** Inspect only small placeholder details; never load full historical tool output. */
export const heartbeatHistoryDetailColumn = `CASE
  WHEN kind = 'tool' AND title LIKE '工具调用 #%'
    AND length(detail_json) <= 512 THEN detail_json
  ELSE NULL END AS detail_json`

export function filterLegacyToolHeartbeats<T extends HistoryToolRow>(rows: T[]): T[] {
  const candidates = new Map<string, string>()
  const realIds = new Set<string>()
  for (const row of rows) {
    if (row.kind !== 'tool') continue
    const meta = parseRecord(row.meta_json, row.id)
    const id = meta?.toolCallId
    if (typeof id !== 'string') continue
    const parent = id.match(/^(.+)-heartbeat-\d+$/)?.[1]
    const detail = parent && row.title === `工具调用 #${id.slice(-6)}`
      && row.detail_json && row.detail_json.length <= 512 ? parseRecord(row.detail_json, row.id) : null
    if (parent && detail?.id === id && detail.title === row.title && detail.status === 'in_progress'
      && Object.keys(detail).every((key) => ['id', 'title', 'status'].includes(key))) {
      candidates.set(row.id, parent)
    } else {
      realIds.add(id)
    }
  }
  return rows.filter((row) => {
    const parent = candidates.get(row.id)
    return !parent || !realIds.has(parent)
  })
}

function parseRecord(json: string | null, itemId: string): Record<string, unknown> | null {
  if (!json) return null
  try {
    const value: unknown = JSON.parse(json)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch (err) {
    log.debug({ err, itemId }, 'Invalid legacy process metadata; retaining history item')
    return null
  }
}
