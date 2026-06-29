import type { Migration } from '../migrator.js'

export const previewsMigration: Migration = {
  version: '029',
  name: 'previews',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS previews (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        source_path TEXT NOT NULL,
        entry_file TEXT NOT NULL DEFAULT 'index.html',
        target TEXT NOT NULL DEFAULT 'pc',
        task_id TEXT,
        description TEXT,
        created_by_agent_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_previews_project ON previews(project_id);
      CREATE INDEX IF NOT EXISTS idx_previews_task ON previews(task_id);
      CREATE INDEX IF NOT EXISTS idx_previews_created ON previews(created_at DESC);
    `)
  },
}
