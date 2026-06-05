import type { Migration } from '../migrator.js'

function safeAdd(db: Parameters<Migration['up']>[0], table: string, column: string, type: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  } catch {
    // column already exists
  }
}

export const turnProcessItemsMigration: Migration = {
  version: '010',
  name: 'turn-process-items',
  up(db) {
    safeAdd(db, 'messages', 'status', "TEXT NOT NULL DEFAULT 'completed'")
    safeAdd(db, 'messages', 'started_at', 'TEXT')
    safeAdd(db, 'messages', 'completed_at', 'TEXT')
    safeAdd(db, 'messages', 'stats_json', 'TEXT')
    safeAdd(db, 'messages', 'process_item_count', 'INTEGER NOT NULL DEFAULT 0')

    db.exec(`
      CREATE TABLE IF NOT EXISTS turn_process_items (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        kind TEXT NOT NULL,
        status TEXT,
        title TEXT,
        summary TEXT,
        preview TEXT,
        content TEXT,
        detail_json TEXT,
        meta_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_turn_process_message_sequence
        ON turn_process_items(message_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_turn_process_session_message_sequence
        ON turn_process_items(session_id, message_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_turn_process_session_kind_status
        ON turn_process_items(session_id, kind, status);
    `)
  },
}
