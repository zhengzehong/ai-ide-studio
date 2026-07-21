import type { Migration } from '../migrator.js'

export const queryReadModelIndexesMigration: Migration = {
  version: '042',
  name: 'query-read-model-indexes',
  up(db) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_session_role_status
        ON messages(session_id, role, status);
      CREATE INDEX IF NOT EXISTS idx_turn_process_items_session_status
        ON turn_process_items(session_id, status);
      CREATE INDEX IF NOT EXISTS idx_sessions_task_started
        ON sessions(task_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_task_events_type_task_sequence
        ON task_events(type, task_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_tasks_project_status_created
        ON tasks(project_id, status, created_at DESC);
    `)
  },
}
