import type { Migration } from '../migrator.js'

export const inspirationCompletionMigration: Migration = {
  version: '056',
  name: 'inspiration-completion',
  up(db) {
    const columns = new Set(
      db.prepare<[], { name: string }>('PRAGMA table_info(inspiration_notes)').all().map((row) => row.name),
    )
    if (!columns.has('completed_at')) {
      db.exec('ALTER TABLE inspiration_notes ADD COLUMN completed_at TEXT')
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_inspiration_notes_completion
        ON inspiration_notes(project_id, completed_at, updated_at DESC, id DESC)
    `)
  },
}
