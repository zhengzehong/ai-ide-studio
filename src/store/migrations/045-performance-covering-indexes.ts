import type { Migration } from '../migrator.js'

export const performanceCoveringIndexesMigration: Migration = {
  version: '045',
  name: 'performance-covering-indexes',
  up(db) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_project_created
        ON tasks(project_id, created_at DESC);
    `)
  },
}
