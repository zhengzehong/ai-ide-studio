import type { Migration } from '../migrator.js'

export const agentMemoryBuiltinDimsMigration: Migration = {
  version: '034',
  name: 'agent-memory-builtin-dims',
  up(db) {
    db.exec(`
      ALTER TABLE agent_memory_dimensions ADD COLUMN is_builtin INTEGER NOT NULL DEFAULT 0;
    `)
  },
}
