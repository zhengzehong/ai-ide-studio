import type { Migration } from '../migrator.js'

export const primarySessionUniqueMigration: Migration = {
  version: '046',
  name: 'primary-session-unique',
  up(db) {
    db.exec(`
      UPDATE sessions
      SET is_primary = 0
      WHERE is_primary = 1
        AND deleted_at IS NULL
        AND is_template = 0
        AND rowid NOT IN (
          SELECT MIN(rowid)
          FROM sessions
          WHERE is_primary = 1 AND deleted_at IS NULL AND is_template = 0
          GROUP BY agent_id
        );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_one_primary_per_agent
      ON sessions(agent_id)
      WHERE is_primary = 1 AND deleted_at IS NULL AND is_template = 0;
    `)
  },
}
