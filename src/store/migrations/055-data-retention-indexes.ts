import type { Migration } from '../migrator.js'

export const dataRetentionIndexesMigration: Migration = {
  version: '055',
  name: 'data-retention-indexes',
  up(db) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_session_events_message_id
        ON session_events(message_id);
      CREATE INDEX IF NOT EXISTS idx_messages_retention
        ON messages(session_id, role, status, completed_at DESC, id DESC);
    `)
  },
}
