import type { Migration } from '../migrator.js'

export const agentMemoryInjectFullMigration: Migration = {
  version: '035',
  name: 'agent-memory-inject-full',
  up(db) {
    db.exec(`
      ALTER TABLE agent_memory_entries ADD COLUMN inject_full INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_agent_memory_entries_inject_full
        ON agent_memory_entries(inject_full) WHERE inject_full = 1 AND deleted_at IS NULL;
    `)
  },
}
