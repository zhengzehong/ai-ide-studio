import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { toolBindingStore, toolStore } from '../../src/store/tools.js'
import { seedBuiltinTools } from '../../src/tools/seed.js'
import { resolveVisiblePlatformTools } from '../../src/tools/registry/visibility-resolver.js'
import { teamService } from '../../src/core/teams.js'
import { teamToolBindingsBackfillMigration } from '../../src/store/migrations/073-team-tool-bindings-backfill.js'

/** 存量库最小表结构：迁移只读 tools / team_members，写 tool_bindings。 */
function legacySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE tool_bindings (
      id TEXT PRIMARY KEY,
      tool_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      target_id TEXT,
      enabled INTEGER NOT NULL,
      config_override_json TEXT,
      created_at TEXT NOT NULL
    );
  `)
}

function seedLegacyRows(db: Database.Database): void {
  const member = db.prepare(`INSERT INTO team_members
    (id, team_id, project_id, agent_id, session_id, name, role, status, created_at, updated_at)
    VALUES (?, 'team-1', 'project-1', ?, ?, ?, ?, 'active', '2026-01-01', '2026-01-01')`)
  member.run('tm-leader', 'agent-leader', 'sess-leader', 'Master', 'leader')
  member.run('tm-worker', 'agent-worker', 'sess-worker', 'Dev-GLM', 'member')
  const tool = db.prepare('INSERT INTO tools (id, name) VALUES (?, ?)')
  for (const name of [
    'team.get', 'team.status', 'team.member.list', 'team.mailbox.send', 'team.task.update',
    'team.member.spawn', 'team.member.message', 'team.task.create',
  ]) {
    tool.run(`tool-${name}`, name)
  }
}

function bindingCount(db: Database.Database): number {
  return db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM tool_bindings').get()!.count
}

function enabledTools(db: Database.Database, agentId: string): string[] {
  return db.prepare<[string], { name: string }>(`
    SELECT t.name FROM tool_bindings b JOIN tools t ON t.id = b.tool_id
    WHERE b.scope = 'agent' AND b.target_id = ? AND b.enabled = 1
    ORDER BY t.name
  `).all(agentId).map((row) => row.name)
}

describe('team tool bindings backfill migration 073', () => {
  test('存量团队（无任何绑定）迁移后 leader 与成员分别拿到各自 profile 的团队工具', () => {
    const db = new Database(':memory:')
    legacySchema(db)
    seedLegacyRows(db)

    teamToolBindingsBackfillMigration.up(db)

    // leader：编排类工具齐全（含后加的 team.status）
    expect(enabledTools(db, 'agent-leader')).toEqual([
      'team.get', 'team.mailbox.send', 'team.member.list', 'team.member.message',
      'team.member.spawn', 'team.status', 'team.task.create', 'team.task.update',
    ])
    // 成员：拿到协作集，且不含 leader 专属编排工具
    expect(enabledTools(db, 'agent-worker')).toEqual([
      'team.get', 'team.mailbox.send', 'team.member.list', 'team.status', 'team.task.update',
    ])
    db.close()
  })

  test('幂等：重复执行不重复插行，已存在的绑定（含显式关闭）不被覆盖', () => {
    const db = new Database(':memory:')
    legacySchema(db)
    seedLegacyRows(db)
    // 成员此前被显式关闭了 mailbox.send：迁移必须尊重既有行。
    db.prepare(`INSERT INTO tool_bindings (id, tool_id, scope, target_id, enabled, config_override_json, created_at)
      VALUES ('tb-manual', 'tool-team.mailbox.send', 'agent', 'agent-worker', 0, NULL, '2026-01-01')`).run()

    teamToolBindingsBackfillMigration.up(db)
    const afterFirst = bindingCount(db)
    teamToolBindingsBackfillMigration.up(db)

    expect(bindingCount(db)).toBe(afterFirst)
    expect(enabledTools(db, 'agent-worker')).not.toContain('team.mailbox.send')
    expect(db.prepare<[], { enabled: number }>("SELECT enabled FROM tool_bindings WHERE id = 'tb-manual'").get()!.enabled).toBe(0)
    db.close()
  })

  test('全新库（工具尚未 seed）不写入任何绑定', () => {
    const db = new Database(':memory:')
    legacySchema(db)
    db.prepare(`INSERT INTO team_members
      (id, team_id, project_id, agent_id, session_id, name, role, status, created_at, updated_at)
      VALUES ('tm-1', 'team-1', 'project-1', 'agent-1', 'sess-1', 'Master', 'leader', 'active', '2026-01-01', '2026-01-01')`).run()

    teamToolBindingsBackfillMigration.up(db)

    expect(bindingCount(db)).toBe(0)
    db.close()
  })

  test('已移除成员不回填', () => {
    const db = new Database(':memory:')
    legacySchema(db)
    seedLegacyRows(db)
    db.prepare("UPDATE team_members SET status = 'removed' WHERE agent_id = 'agent-worker'").run()

    teamToolBindingsBackfillMigration.up(db)

    expect(enabledTools(db, 'agent-worker')).toEqual([])
    db.close()
  })

  test('真实库：删绑定模拟存量团队 → 迁移后 leader 会话可见 team.status，重复执行不重复插', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leaderAgent = agentStore.create({ name: 'Master', type: 'architect', runtime: 'mock', projectId: project.id })
    const created = teamService.create({ projectId: project.id, leaderAgentId: leaderAgent.id, name: '存量团队' })
    const statusTool = toolStore.getByName('team.status')
    if (!statusTool) throw new Error('team.status 未 seed')
    const leaderAgentId = created.member.agent_id
    const leaderSessionId = created.session.id

    // 模拟"工具晚于团队创建"：删掉 agent 作用域绑定后，leader 会话看不到该工具。
    toolBindingStore.remove(statusTool.id, 'agent', leaderAgentId)
    const before = resolveVisiblePlatformTools({ agentId: leaderAgentId, projectId: project.id, sessionId: leaderSessionId })
      .map((tool) => tool.definition.name)
    expect(before).not.toContain('team.status')

    teamToolBindingsBackfillMigration.up(getDb())
    const after = resolveVisiblePlatformTools({ agentId: leaderAgentId, projectId: project.id, sessionId: leaderSessionId })
      .map((tool) => tool.definition.name)
    expect(after).toContain('team.status')

    const countBefore = getDb().prepare<[], { count: number }>(
      "SELECT COUNT(*) AS count FROM tool_bindings WHERE scope = 'agent' AND target_id = ?",
    ).get(leaderAgentId)!.count
    teamToolBindingsBackfillMigration.up(getDb())
    const countAfter = getDb().prepare<[], { count: number }>(
      "SELECT COUNT(*) AS count FROM tool_bindings WHERE scope = 'agent' AND target_id = ?",
    ).get(leaderAgentId)!.count
    expect(countAfter).toBe(countBefore)
  })
})

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-binding-backfill-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
  seedBuiltinTools()
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})
