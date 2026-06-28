import { getDb } from './db.js'

interface ReadStateRow {
  session_id: string
  read_at: string
}

interface PreferenceRow {
  key: string
  value: string
  updated_at: string
}

export const widgetStateStore = {
  markRead(sessionId: string): void {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO widget_read_state (session_id, read_at)
         VALUES (?, ?)`,
      )
      .run(sessionId, new Date().toISOString())
  },

  isRead(sessionId: string): boolean {
    const row = getDb()
      .prepare<[string], ReadStateRow>('SELECT session_id FROM widget_read_state WHERE session_id = ?')
      .get(sessionId)
    return !!row
  },

  getReadAt(sessionId: string): string | undefined {
    const row = getDb()
      .prepare<[string], ReadStateRow>('SELECT read_at FROM widget_read_state WHERE session_id = ?')
      .get(sessionId)
    return row?.read_at
  },

  listUnread(sessionIds: string[]): string[] {
    if (sessionIds.length === 0) return []
    const placeholders = sessionIds.map(() => '?').join(',')
    const readRows = getDb()
      .prepare<string[], ReadStateRow>(
        `SELECT session_id FROM widget_read_state WHERE session_id IN (${placeholders})`,
      )
      .all(...sessionIds)
    const readSet = new Set(readRows.map((r) => r.session_id))
    return sessionIds.filter((id) => !readSet.has(id))
  },

  getPreference(key: string): string | undefined {
    const row = getDb()
      .prepare<[string], PreferenceRow>('SELECT value FROM widget_preferences WHERE key = ?')
      .get(key)
    return row?.value
  },

  setPreference(key: string, value: string): void {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO widget_preferences (key, value, updated_at)
         VALUES (?, ?, ?)`,
      )
      .run(key, value, new Date().toISOString())
  },

  deletePreference(key: string): void {
    getDb().prepare('DELETE FROM widget_preferences WHERE key = ?').run(key)
  },

  getAllPreferences(): Record<string, string> {
    const rows = getDb()
      .prepare<[], PreferenceRow>('SELECT key, value FROM widget_preferences')
      .all()
    const result: Record<string, string> = {}
    for (const row of rows) {
      result[row.key] = row.value
    }
    return result
  },
}
