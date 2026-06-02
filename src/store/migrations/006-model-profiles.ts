import type { Migration } from '../migrator.js'

export const modelProfilesMigration: Migration = {
  version: '006',
  name: 'model_profiles',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS model_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        runtime TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        context_window INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_model_profiles_runtime ON model_profiles(runtime);
      CREATE INDEX IF NOT EXISTS idx_model_profiles_provider ON model_profiles(provider_id);
    `)
  },
}
