import type { Migration } from '../migrator.js'

export const agentAvatarMigration: Migration = {
  version: '032',
  name: 'agent-avatar',
  up(db) {
    db.exec(`
      ALTER TABLE agents ADD COLUMN avatar_url TEXT;
      ALTER TABLE agent_templates ADD COLUMN avatar_url TEXT;
    `)
  },
}
