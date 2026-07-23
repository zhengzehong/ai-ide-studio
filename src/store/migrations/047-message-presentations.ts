import type { Migration } from '../migrator.js'

export const messagePresentationsMigration: Migration = {
  version: '047',
  name: 'message-presentations',
  up(db) {
    const columns = db.prepare<[], { name: string }>('PRAGMA table_info(messages)').all()
    if (!columns.some((column) => column.name === 'presentations_json')) {
      db.exec('ALTER TABLE messages ADD COLUMN presentations_json TEXT')
    }
  },
}

