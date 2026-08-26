import type { Migration } from '../migrator.js'

export const inspirationContextChatMigration: Migration = {
  version: '054',
  name: 'inspiration-context-chat',
  up(db) {
    const columns = new Set(
      db.prepare<[], { name: string }>('PRAGMA table_info(inspiration_notes)').all().map((row) => row.name),
    )
    if (!columns.has('analysis_draft_json')) {
      db.exec('ALTER TABLE inspiration_notes ADD COLUMN analysis_draft_json TEXT')
    }
    if (!columns.has('analysis_attempt_kind')) {
      db.exec('ALTER TABLE inspiration_notes ADD COLUMN analysis_attempt_kind TEXT')
    }
  },
}
