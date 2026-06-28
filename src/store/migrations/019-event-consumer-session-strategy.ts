import type { Migration } from '../migrator.js'

export const eventConsumerSessionStrategyMigration: Migration = {
  version: '019',
  name: 'event-consumer-session-strategy',
  up(db) {
    addColumnIfMissing(db, 'event_subscriptions', 'consumer_session_mode', "TEXT NOT NULL DEFAULT 'new_each'")
    addColumnIfMissing(db, 'event_subscriptions', 'consumer_session_id', 'TEXT')
    addColumnIfMissing(db, 'event_consumptions', 'session_id', 'TEXT')
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_event_consumptions_session_status
        ON event_consumptions(session_id, status, created_at);
    `)
  },
}

function addColumnIfMissing(db: Parameters<Migration['up']>[0], table: string, column: string, definition: string): void {
  const columns = db.prepare<[], { name: string }>(`PRAGMA table_info(${table})`).all().map((row) => row.name)
  if (columns.includes(column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`)
}
