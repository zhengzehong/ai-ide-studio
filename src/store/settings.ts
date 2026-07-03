import { getDb } from './db.js'

export interface SettingRow {
  key: string
  value: string
  updated_at: string
}

export const settingsStore = {
  get(key: string): string | undefined {
    const row = getDb().prepare<[string], SettingRow>('SELECT key, value, updated_at FROM settings WHERE key = ?').get(key)
    return row?.value
  },

  set(key: string, value: string): void {
    const now = new Date().toISOString()
    getDb().prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, now)
  },

  delete(key: string): void {
    getDb().prepare('DELETE FROM settings WHERE key = ?').run(key)
  },

  list(): SettingRow[] {
    return getDb().prepare<[], SettingRow>('SELECT key, value, updated_at FROM settings ORDER BY key ASC').all()
  },
}
