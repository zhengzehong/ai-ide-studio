import type { Migration } from '../migrator.js'

export const modelAndSkillMigration: Migration = {
  version: '004',
  name: 'model_and_skill_settings',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS model_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        protocol TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL DEFAULT '',
        models_json TEXT NOT NULL DEFAULT '[]',
        is_default INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'prompt',
        content TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'general',
        enabled INTEGER NOT NULL DEFAULT 1,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS skill_bindings (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        target_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE(skill_id, scope, target_id)
      );
    `)
  },
}
