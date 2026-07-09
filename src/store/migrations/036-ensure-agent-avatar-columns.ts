import type { Migration } from '../migrator.js'

function hasColumn(db: Parameters<Migration['up']>[0], table: string, column: string): boolean {
  return db.prepare<[], { name: string }>(`PRAGMA table_info(${table})`).all().some(row => row.name === column)
}

export const ensureAgentAvatarColumnsMigration: Migration = {
  version: '036',
  name: 'ensure-agent-avatar-columns',
  up(db) {
    if (!hasColumn(db, 'agents', 'avatar_url')) {
      db.exec('ALTER TABLE agents ADD COLUMN avatar_url TEXT;')
    }
    if (!hasColumn(db, 'agent_templates', 'avatar_url')) {
      db.exec('ALTER TABLE agent_templates ADD COLUMN avatar_url TEXT;')
    }
  },
}
