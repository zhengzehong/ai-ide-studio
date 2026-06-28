import type { Migration } from '../migrator.js'

export const timelineSummariesMigration: Migration = {
  version: '009',
  name: 'timeline-summaries',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS timeline_summaries (
        id            TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL,
        turns         TEXT NOT NULL,
        summary       TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'raw',
        turn_start_at TEXT NOT NULL,
        model_used    TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_tl_session ON timeline_summaries(session_id);

      CREATE TABLE IF NOT EXISTS timeline_config (
        project_id    TEXT PRIMARY KEY,
        enabled       INTEGER NOT NULL DEFAULT 0,
        provider_id   TEXT,
        model         TEXT,
        api_key       TEXT,
        base_url      TEXT,
        trigger_interval INTEGER NOT NULL DEFAULT 3,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
  },
}
