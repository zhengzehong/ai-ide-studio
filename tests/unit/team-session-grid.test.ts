import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase, getDb } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { teamService } from '../../src/core/teams.js'
import { teamConversationStore } from '../../src/store/team-conversations.js'
import { sessionManager } from '../../src/core/sessions.js'
import { teamSessionGridRepairMigration } from '../../src/store/migrations/068-team-session-grid-repair.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-session-grid-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

function createFixture() {
  const project = projectStore.create({ name: 'P', workDir: tmp })
  const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
  const worker = agentStore.create({ name: 'Worker', type: 'dev', runtime: 'mock', projectId: project.id })
  const leaderSession = sessionStore.create({ agentId: leader.id, projectId: project.id })
  const created = teamService.create({
    projectId: project.id,
    leaderAgentId: leader.id,
    leaderSessionId: leaderSession.id,
    name: 'Alpha',
  })
  const leaderMember = created.member
  return { project, leader, worker, leaderSession, team: created.team, leaderMember }
}

describe('team session grid (线 × 成员) model', () => {
  test('first conversation reuses leader primary session as master (no orphan master)', () => {
    const f = createFixture()
    const detail = teamService.createConversation(f.team.id)
    expect(detail.conversation.master_session_id).toBe(f.leaderSession.id)
    const grid = teamConversationStore.listMembers(detail.conversation.id).find((entry) => entry.member_id === f.leaderMember.id)
    expect(grid?.session_id).toBe(f.leaderSession.id)
  })

  test('second conversation creates a fresh master session instead of reusing primary', () => {
    const f = createFixture()
    const first = teamService.createConversation(f.team.id)
    const second = teamService.createConversation(f.team.id)
    expect(second.conversation.master_session_id).not.toBe(f.leaderSession.id)
    expect(second.conversation.master_session_id).not.toBe(first.conversation.master_session_id)
  })

  test('spawning a member registers them into every active conversation grid (reusing primary)', () => {
    const f = createFixture()
    const conversation = teamService.createConversation(f.team.id)
    const spawned = teamService.spawnMember({ teamId: f.team.id, agentId: f.worker.id })
    const grid = teamConversationStore.listMembers(conversation.conversation.id).find((entry) => entry.member_id === spawned.member.id)
    expect(grid?.session_id).toBe(spawned.member.session_id)
  })

  test('dispatchMessage routes to the member grid session of the current conversation', () => {
    const f = createFixture()
    const conversation = teamService.createConversation(f.team.id)
    const spawned = teamService.spawnMember({ teamId: f.team.id, agentId: f.worker.id })
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    teamService.dispatchMessage({
      teamId: f.team.id,
      memberId: spawned.member.id,
      content: '请完成这个任务',
      sourceSessionId: conversation.conversation.master_session_id,
    })
    expect(enqueue.mock.calls[0]?.[0]).toBe(spawned.member.session_id)
  })

  test('task completion wakes the leader on the conversation recorded via initiator_session_id', async () => {
    const f = createFixture()
    const conversation = teamService.createConversation(f.team.id)
    const spawned = teamService.spawnMember({ teamId: f.team.id, agentId: f.worker.id })
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.useFakeTimers()
    const task = teamService.createTask({
      teamId: f.team.id,
      title: '写一首诗',
      assigneeMemberId: spawned.member.id,
      sourceSessionId: conversation.conversation.master_session_id,
    })
    teamService.updateTask({ teamId: f.team.id, taskId: task.id, status: 'completed', actor: { teamMemberId: spawned.member.id } })
    await vi.advanceTimersByTimeAsync(2100)
    expect(enqueue.mock.calls[0]?.[0]).toBe(conversation.conversation.master_session_id)
  })

  test('mailbox result wakes the leader on the member conversation line', async () => {
    const f = createFixture()
    const conversation = teamService.createConversation(f.team.id)
    const spawned = teamService.spawnMember({ teamId: f.team.id, agentId: f.worker.id })
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.useFakeTimers()
    teamService.sendMailbox({
      teamId: f.team.id,
      type: 'result',
      content: '诗已交付',
      fromMemberId: spawned.member.id,
      sourceSessionId: spawned.member.session_id,
    })
    await vi.advanceTimersByTimeAsync(2100)
    expect(enqueue.mock.calls[0]?.[0]).toBe(conversation.conversation.master_session_id)
  })

  test('falls back to leader member-bound session when no conversation exists', async () => {
    const f = createFixture()
    const spawned = teamService.spawnMember({ teamId: f.team.id, agentId: f.worker.id })
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.useFakeTimers()
    teamService.sendMailbox({ teamId: f.team.id, type: 'result', content: 'done', fromMemberId: spawned.member.id })
    await vi.advanceTimersByTimeAsync(2100)
    expect(enqueue.mock.calls[0]?.[0]).toBe(f.leaderSession.id)
  })

  test('leader primary with history is not reused; a fresh master session is created', () => {
    const f = createFixture()
    getDb().prepare('UPDATE sessions SET last_message_at = ? WHERE id = ?').run(new Date().toISOString(), f.leaderSession.id)
    const detail = teamService.createConversation(f.team.id)
    expect(detail.conversation.master_session_id).not.toBe(f.leaderSession.id)
  })
})

describe('migration 068 team_session_grid_repair', () => {
  test('repairs missing member grids and realigns orphan leader session', () => {
    const f = createFixture()
    const conversation = teamService.createConversation(f.team.id)
    const spawned = teamService.spawnMember({ teamId: f.team.id, agentId: f.worker.id })
    const db = getDb()

    // 模拟存量脏数据：成员格子缺失 + leader 指向不属于任何格子的孤儿 session
    const orphanSession = sessionStore.create({ agentId: f.leader.id, projectId: f.project.id })
    db.prepare('DELETE FROM team_conversation_members WHERE member_id = ?').run(spawned.member.id)
    db.prepare('UPDATE team_members SET session_id = ? WHERE id = ?').run(orphanSession.id, f.leaderMember.id)

    teamSessionGridRepairMigration.up(db)

    const memberGrid = teamConversationStore.listMembers(conversation.conversation.id).find((entry) => entry.member_id === spawned.member.id)
    expect(memberGrid?.session_id).toBe(spawned.member.session_id)

    const leaderRow = db.prepare('SELECT session_id FROM team_members WHERE id = ?').get(f.leaderMember.id) as { session_id: string }
    expect(leaderRow.session_id).toBe(conversation.conversation.master_session_id)
  })

  test('fills a missing leader grid with the conversation master session (invariant: leader grid = master)', () => {
    const f = createFixture()
    const conversation = teamService.createConversation(f.team.id)
    const db = getDb()

    // 构造"leader 无任何格子"的存量形态（旧版开线遗留）：删掉 leader 格子，primary 指向孤儿
    const orphanSession = sessionStore.create({ agentId: f.leader.id, projectId: f.project.id })
    db.prepare('DELETE FROM team_conversation_members WHERE member_id = ?').run(f.leaderMember.id)
    db.prepare('UPDATE team_members SET session_id = ? WHERE id = ?').run(orphanSession.id, f.leaderMember.id)

    teamSessionGridRepairMigration.up(db)

    const leaderGrid = teamConversationStore.listMembers(conversation.conversation.id).find((entry) => entry.member_id === f.leaderMember.id)
    expect(leaderGrid?.session_id).toBe(conversation.conversation.master_session_id)
    const leaderRow = db.prepare('SELECT session_id FROM team_members WHERE id = ?').get(f.leaderMember.id) as { session_id: string }
    expect(leaderRow.session_id).toBe(conversation.conversation.master_session_id)
  })

  test('skips members whose primary session already has history (runtime will self-heal)', () => {
    const f = createFixture()
    const conversation = teamService.createConversation(f.team.id)
    const spawned = teamService.spawnMember({ teamId: f.team.id, agentId: f.worker.id })
    const db = getDb()

    // 成员 primary 已有历史：与运行时复用规则一致，migration 不应补格子
    db.prepare('DELETE FROM team_conversation_members WHERE member_id = ?').run(spawned.member.id)
    db.prepare('UPDATE sessions SET last_message_at = ? WHERE id = ?').run(new Date().toISOString(), spawned.member.session_id)

    teamSessionGridRepairMigration.up(db)

    const memberGrid = teamConversationStore.listMembers(conversation.conversation.id).find((entry) => entry.member_id === spawned.member.id)
    expect(memberGrid?.session_id ?? null).toBeNull()
  })
})
