import type { Migration } from '../migrator.js'

export const readingItemsMigration: Migration = {
  version: '059',
  name: 'reading-items',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reading_items (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        session_id TEXT,
        agent_id TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        format TEXT NOT NULL CHECK (format IN ('md', 'html', 'url')),
        mount_path TEXT,
        entry_file TEXT,
        url TEXT,
        status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        read_at TEXT,
        archived_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL,
        CHECK (
          (format IN ('md', 'html') AND mount_path IS NOT NULL AND entry_file IS NOT NULL AND url IS NULL)
          OR (format = 'url' AND mount_path IS NULL AND entry_file IS NULL AND url IS NOT NULL)
        )
      );

      CREATE INDEX IF NOT EXISTS idx_reading_items_status_created
        ON reading_items(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reading_items_project_status
        ON reading_items(project_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reading_items_session
        ON reading_items(session_id);
    `)
  },
}
