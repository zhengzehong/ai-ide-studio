import type { Migration } from '../migrator.js'

export const taskInitiatorMigration: Migration = {
  version: '039',
  name: 'task-initiator',
  up(db) {
    db.exec(`ALTER TABLE tasks ADD COLUMN initiator_agent_id TEXT`)
    db.exec(`ALTER TABLE tasks ADD COLUMN initiator_session_id TEXT`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_initiator ON tasks(initiator_agent_id)`)
  },
}
