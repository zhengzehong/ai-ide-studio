import type { Migration } from '../migrator.js'

export const taskExecutionModesMigration: Migration = {
  version: '025',
  name: 'task-execution-modes',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_execution_modes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        prompt_template TEXT NOT NULL DEFAULT '',
        report_template TEXT NOT NULL DEFAULT '',
        is_builtin INTEGER NOT NULL DEFAULT 0,
        project_id TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_task_execution_modes_project ON task_execution_modes(project_id);

      ALTER TABLE tasks ADD COLUMN execution_mode_id TEXT;
    `)
  },
}
