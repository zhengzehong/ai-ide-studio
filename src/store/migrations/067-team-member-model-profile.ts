import type { Migration } from '../migrator.js'

export const teamMemberModelProfileMigration: Migration = {
  version: '067',
  name: 'team_member_model_profile',
  up(db): void {
    const columns = db.prepare<[], { name: string }>('PRAGMA table_info(team_members)').all()
    if (!columns.some((column) => column.name === 'model_profile_id')) {
      db.exec(`
        ALTER TABLE team_members
        ADD COLUMN model_profile_id TEXT REFERENCES model_profiles(id) ON DELETE SET NULL
      `)
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_team_members_model_profile
      ON team_members(model_profile_id)
    `)
  },
}
