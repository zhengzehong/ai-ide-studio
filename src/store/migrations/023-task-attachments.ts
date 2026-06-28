import type { Migration } from '../migrator.js'

export const taskAttachmentsMigration: Migration = {
  version: '023',
  name: 'task-attachments',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_attachments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        name TEXT,
        mime_type TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        absolute_path TEXT NOT NULL,
        url TEXT NOT NULL,
        size INTEGER NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_task_attachments_task_order
        ON task_attachments(task_id, sort_order);
    `)
  },
}
