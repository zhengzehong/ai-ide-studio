/**
 * 团队工具绑定启动对账（ensureTeamToolBindings）单测：覆盖二审抓到的真缺口——
 * migration 073 在"干净升级库"上会空转（runMigrations 早于 seedBuiltinTools，迁移时 team.status 行还不存在），
 * 真正的兜底是 seedBuiltinTools() 之后的启动对账。
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { toolBindingStore, toolStore } from '../../src/store/tools.js'
import { teamMemberStore, teamStore } from '../../src/store/teams.js'
import { ensureTeamToolBindings } from '../../src/store/team-tool-bindings.js'
import { seedBuiltinTools } from '../../src/tools/seed.js'
import { resolveVisiblePlatformTools } from '../../src/tools/registry/visibility-resolver.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-binding-reconcile-'))
  // 干净升级路径的真实顺序：initDatabase 先跑迁移（073 此时空转，tools 表为空）。
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

/** 存量团队：直接用 store 建，绕开 applyToolProfileToAgent（模拟"建团时还没有 team.status 这个工具"）。 */
function createLegacyTeamFixture() {
  const project = projectStore.create({ name: 'P', workDir: tmp })
  const leaderAgent = agentStore.create({ name: 'Master', type: 'architect', runtime: 'mock', projectId: project.id })
  const leaderSession = sessionStore.create({ agentId: leaderAgent.id, projectId: project.id })
  const team = teamStore.create({ projectId: project.id, name: '存量团队' })
  const leader = teamMemberStore.create({
    teamId: team.id, projectId: project.id, agentId: leaderAgent.id, sessionId: leaderSession.id,
    name: 'Master', role: 'leader',
  })
  const workerAgent = agentStore.create({ name: 'Dev-GLM', type: 'dev', runtime: 'mock', projectId: project.id })
  const workerSession = sessionStore.create({ agentId: workerAgent.id, projectId: project.id })
  const worker = teamMemberStore.create({
    teamId: team.id, projectId: project.id, agentId: workerAgent.id, sessionId: workerSession.id,
    name: 'Dev-GLM', role: 'member',
  })
  return { project, team, leader, leaderSessionId: leaderSession.id, worker }
}

function visibleTools(agentId: string, projectId: string, sessionId: string): string[] {
  return resolveVisiblePlatformTools({ agentId, projectId, sessionId }).map((tool) => tool.definition.name)
}

function agentBindingCount(agentId: string): number {
  return getDb().prepare<[string], { count: number }>(
    "SELECT COUNT(*) AS count FROM tool_bindings WHERE scope = 'agent' AND target_id = ?",
  ).get(agentId)!.count
}

describe('ensureTeamToolBindings (启动对账)', () => {
  test('干净升级路径：迁移空转 → seed 之后对账 → leader 会话恢复可见 team.status', () => {
    const fixture = createLegacyTeamFixture()
    // 迁移已在 initDatabase 中跑完（含 073），此时工具行还不存在——073 空转的现场。
    expect(toolStore.getByName('team.status')).toBeUndefined()

    seedBuiltinTools()
    // seed 之后、对账之前：存量团队仍然看不到新工具（二审复现的核心断言）。
    expect(visibleTools(fixture.leader.agent_id, fixture.project.id, fixture.leaderSessionId)).not.toContain('team.status')

    const added = ensureTeamToolBindings()
    expect(added).toBeGreaterThan(0)
    const visible = visibleTools(fixture.leader.agent_id, fixture.project.id, fixture.leaderSessionId)
    expect(visible).toContain('team.status')
    // 成员同样拿到（协作集里也有 team.status）
    expect(visibleTools(fixture.worker.agent_id, fixture.project.id, fixture.worker.session_id)).toContain('team.status')
  })

  test('对账幂等：重复执行不新增行，enabled=0 的既有绑定不被覆盖', () => {
    const fixture = createLegacyTeamFixture()
    seedBuiltinTools()
    ensureTeamToolBindings()

    const leaderBindings = agentBindingCount(fixture.leader.agent_id)
    const statusTool = toolStore.getByName('team.status')
    if (!statusTool) throw new Error('team.status 未 seed')
    // 模拟"用户显式关掉了 team.status"：再跑对账必须尊重这个选择。
    toolBindingStore.setEnabled(statusTool.id, 'agent', fixture.leader.agent_id, false)

    expect(ensureTeamToolBindings()).toBe(0)
    expect(agentBindingCount(fixture.leader.agent_id)).toBe(leaderBindings)
    expect(visibleTools(fixture.leader.agent_id, fixture.project.id, fixture.leaderSessionId)).not.toContain('team.status')
    expect(toolBindingStore.list(statusTool.id)
      .find((row) => row.scope === 'agent' && row.target_id === fixture.leader.agent_id)?.enabled).toBe(0)
  })

  test('全新库（工具未 seed）不写入任何绑定', () => {
    createLegacyTeamFixture()
    expect(ensureTeamToolBindings()).toBe(0)
    expect(getDb().prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM tool_bindings').get()!.count).toBe(0)
  })
})
