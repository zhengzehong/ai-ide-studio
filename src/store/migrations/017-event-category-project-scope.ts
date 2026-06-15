import type { Migration } from '../migrator.js'

export const eventCategoryProjectScopeMigration: Migration = {
  version: '017',
  name: 'event-category-project-scope',
  up(db) {
    db.exec(`
      ALTER TABLE event_categories RENAME TO event_categories_old;

      CREATE TABLE event_categories (
        id TEXT NOT NULL,
        project_id TEXT,
        scope_key TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        schema_json TEXT NOT NULL,
        default_priority TEXT NOT NULL DEFAULT 'medium',
        allowed_writers_json TEXT NOT NULL DEFAULT '["*"]',
        allowed_consumers_json TEXT NOT NULL DEFAULT '["*"]',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope_key, id)
      );

      INSERT INTO event_categories (
        id, project_id, scope_key, name, description, schema_json, default_priority,
        allowed_writers_json, allowed_consumers_json, enabled, created_at, updated_at
      )
      SELECT
        id, NULL, '__global__', name, description, schema_json, default_priority,
        allowed_writers_json, allowed_consumers_json, enabled, created_at, updated_at
      FROM event_categories_old;

      DROP TABLE event_categories_old;

      CREATE INDEX IF NOT EXISTS idx_event_categories_project
        ON event_categories(project_id, id);
    `)
  },
}
