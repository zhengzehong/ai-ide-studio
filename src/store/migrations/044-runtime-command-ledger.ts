import type { Migration } from '../migrator.js'

export const runtimeCommandLedgerMigration: Migration = {
  version: '044',
  name: 'runtime-command-ledger',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS runtime_commands (
        command_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL,
        type TEXT NOT NULL,
        session_id TEXT NOT NULL,
        project_id TEXT,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(type, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_runtime_commands_recoverable
        ON runtime_commands(status, created_at, command_id);
      CREATE INDEX IF NOT EXISTS idx_runtime_commands_session_created
        ON runtime_commands(session_id, created_at, command_id);
    `)
  },
}
