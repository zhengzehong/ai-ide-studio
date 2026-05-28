import type { Migration } from '../migrator.js'

function safeAdd(db: Parameters<Migration['up']>[0], table: string, column: string, type: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  } catch {
    // column already exists
  }
}

export const projectScopeMigration: Migration = {
  version: '002',
  name: 'project_scope',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        work_dir TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        runtime TEXT NOT NULL DEFAULT 'claude',
        icon TEXT NOT NULL DEFAULT 'bot',
        system_prompt TEXT NOT NULL DEFAULT '',
        description TEXT,
        skills_json TEXT,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)

    safeAdd(db, 'agents', 'project_id', 'TEXT')
    safeAdd(db, 'agents', 'template_id', 'TEXT')
    safeAdd(db, 'agents', 'system_prompt', "TEXT DEFAULT ''")
    safeAdd(db, 'agents', 'icon', "TEXT DEFAULT 'bot'")
    safeAdd(db, 'tasks', 'project_id', 'TEXT')
    safeAdd(db, 'rules', 'project_id', 'TEXT')
    safeAdd(db, 'sessions', 'project_id', 'TEXT')
    safeAdd(db, 'sessions', 'title', 'TEXT')
    safeAdd(db, 'sessions', 'updated_at', 'TEXT')
    safeAdd(db, 'sessions', 'last_message_at', 'TEXT')
    safeAdd(db, 'sessions', 'archived_at', 'TEXT')
    safeAdd(db, 'sessions', 'deleted_at', 'TEXT')
  },
}
