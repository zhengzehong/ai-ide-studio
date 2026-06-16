import type { Migration } from '../migrator.js'

export const modelProfileDefaultMigration: Migration = {
  version: '020',
  name: 'model-profile-default',
  up(db) {
    const columns = db.prepare<[], { name: string }>('PRAGMA table_info(model_profiles)').all()
    if (!columns.some((column) => column.name === 'is_default')) {
      db.exec('ALTER TABLE model_profiles ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0')
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_model_profiles_runtime_default ON model_profiles(runtime, is_default)')
  },
}
