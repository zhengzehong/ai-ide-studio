import type { Migration } from '../migrator.js'

export const writerOutboxMigration: Migration = {
  version: '043',
  name: 'writer-outbox',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS writer_batch_commits (
        batch_id TEXT PRIMARY KEY,
        session_id TEXT,
        stream_generation TEXT,
        first_sequence INTEGER,
        last_sequence INTEGER,
        committed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_writer_batch_session_order
        ON writer_batch_commits(session_id, stream_generation, last_sequence);

      CREATE TABLE IF NOT EXISTS outbox_events (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        project_id TEXT,
        session_id TEXT,
        version INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        published_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
        ON outbox_events(published_at, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_outbox_aggregate_version
        ON outbox_events(aggregate_type, aggregate_id, version);
    `)
  },
}
