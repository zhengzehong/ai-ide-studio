import type { Migration } from '../migrator.js'

export const taskStepsMigration: Migration = {
  version: '037',
  name: 'task-steps',
  up(db) {
    db.exec(`
      UPDATE tasks SET status = 'draft' WHERE status = 'backlog';
      UPDATE tasks SET status = 'running' WHERE status = 'executing';
    `)

    db.exec(`
      CREATE TABLE IF NOT EXISTS task_steps (
        id                  TEXT PRIMARY KEY,
        task_id             TEXT NOT NULL,
        title               TEXT NOT NULL,
        description         TEXT,
        status              TEXT NOT NULL DEFAULT 'pending',
        assignee_agent_id   TEXT,
        session_id          TEXT,
        current_stage       TEXT,
        sort_order          INTEGER NOT NULL DEFAULT 0,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (assignee_agent_id) REFERENCES agents(id),
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_task_steps_task_id ON task_steps(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_steps_status ON task_steps(status);
      CREATE INDEX IF NOT EXISTS idx_task_steps_assignee ON task_steps(assignee_agent_id);

      CREATE TABLE IF NOT EXISTS task_step_dependencies (
        step_id             TEXT NOT NULL,
        depends_on_step_id  TEXT NOT NULL,
        task_id             TEXT NOT NULL,
        created_at          TEXT NOT NULL,
        PRIMARY KEY (step_id, depends_on_step_id),
        FOREIGN KEY (step_id) REFERENCES task_steps(id) ON DELETE CASCADE,
        FOREIGN KEY (depends_on_step_id) REFERENCES task_steps(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_step_deps_step ON task_step_dependencies(step_id);
      CREATE INDEX IF NOT EXISTS idx_step_deps_depends_on ON task_step_dependencies(depends_on_step_id);
      CREATE INDEX IF NOT EXISTS idx_step_deps_task ON task_step_dependencies(task_id);
    `)
  },
}
