import type { Migration } from '../migrator.js'

export const taskPageIndexesMigration: Migration = {
  version: '057',
  name: 'task-page-indexes',
  up(db) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_page_project_created
        ON tasks(project_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_tasks_page_project_status_created
        ON tasks(project_id, status, created_at DESC, id DESC);
    `)
  },
}
