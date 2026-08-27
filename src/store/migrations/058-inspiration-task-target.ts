import type { Migration } from '../migrator.js'

export const inspirationTaskTargetMigration: Migration = {
  version: '058',
  name: 'inspiration-task-target',
  up(db) {
    db.exec(`
      ALTER TABLE project_inspirations ADD COLUMN task_default_agent_id TEXT;
      ALTER TABLE project_inspirations ADD COLUMN task_default_session_id TEXT;
      ALTER TABLE project_inspirations ADD COLUMN task_target_priority TEXT NOT NULL DEFAULT 'default';
    `)
  },
}
