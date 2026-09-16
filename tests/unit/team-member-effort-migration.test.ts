import Database from 'better-sqlite3'
import { describe, expect, test } from 'vitest'
import { teamMemberEffortMigration } from '../../src/store/migrations/072-team-member-effort.js'

function legacyMembersTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      model_profile_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
}

describe('team member effort migration 072', () => {
  test('adds reasoning_effort as nullable so existing rows follow the profile', () => {
    const db = new Database(':memory:')
    legacyMembersTable(db)
    db.prepare(`
      INSERT INTO team_members (id, team_id, project_id, agent_id, session_id, name, role, status, created_at, updated_at)
      VALUES ('tm-1', 'team-1', 'project-1', 'agent-1', 'session-1', 'Dev-GLM', 'member', 'active', '2026-01-01', '2026-01-01')
    `).run()

    teamMemberEffortMigration.up(db)

    const rows = db.prepare<[], { id: string; reasoning_effort: string | null }>('SELECT id, reasoning_effort FROM team_members').all()
    // 历史成员不被迫补值：NULL 语义＝跟随模型档案 / 系统默认。
    expect(rows).toEqual([{ id: 'tm-1', reasoning_effort: null }])
    db.close()
  })

  test('is idempotent and keeps an already-written effort value', () => {
    const db = new Database(':memory:')
    legacyMembersTable(db)
    teamMemberEffortMigration.up(db)
    db.prepare(`
      INSERT INTO team_members (id, team_id, project_id, agent_id, session_id, name, role, status, reasoning_effort, created_at, updated_at)
      VALUES ('tm-2', 'team-1', 'project-1', 'agent-2', 'session-2', 'Dev-Kimi', 'member', 'active', 'max', '2026-01-01', '2026-01-01')
    `).run()

    teamMemberEffortMigration.up(db)

    const columns = db.prepare<[], { name: string }>('PRAGMA table_info(team_members)').all()
    expect(columns.filter((column) => column.name === 'reasoning_effort')).toHaveLength(1)
    expect(db.prepare<[string], { reasoning_effort: string | null }>('SELECT reasoning_effort FROM team_members WHERE id = ?').get('tm-2')?.reasoning_effort).toBe('max')
    db.close()
  })
})
