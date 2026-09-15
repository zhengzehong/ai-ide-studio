import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase, getDb } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import { teamService } from '../../src/core/teams.js'
import { events } from '../../src/core/events.js'
import { projectSessionStatsStore } from '../../src/store/session-stats.js'
import { listTeamActivity } from '../../src/store/team-activity.js'
import { markTeamConversationRead, markTeamConversationUnread } from '../../src/core/team-conversation-read.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-conversation-activity-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('team conversation line running state', () => {
  test('marks only this conversation unread including its member replies', () => {
    const fixture = createTeamFixture()
    const second = teamService.createConversation(fixture.team.id, 'second')
    const firstIds = teamService.listConversations(fixture.team.id).find(line => line.id === fixture.firstConversation.id)!.grid_session_ids
    for (const id of [...firstIds, second.conversation.master_session_id]) {
      sessionStore.touch(id, '2030-01-01T00:00:00.000Z')
      sessionStore.markRead(id, '2030-01-02T00:00:00.000Z')
    }
    markTeamConversationUnread(fixture.firstConversation.id)
    expect(firstIds.every(id => sessionStore.get(id)!.last_read_at! < '2030-01-01T00:00:00.000Z')).toBe(true)
    expect(sessionStore.get(second.conversation.master_session_id)!.last_read_at).toBe('2030-01-02T00:00:00.000Z')
  })
  test('broadcasts the canonical marked_unread event so client unread fences light up', () => {
    const fixture = createTeamFixture()
    const id = fixture.firstConversation.master_session_id
    sessionStore.touch(id, '2030-01-01T00:00:00.000Z')
    const emit = vi.spyOn(events, 'emit')
    markTeamConversationUnread(fixture.firstConversation.id)
    const payload = emit.mock.calls
      .filter(([channel]) => channel === 'session:changed')
      .map(([, data]) => data as { sessionId: string; data: Record<string, unknown> })
      .find(entry => entry.sessionId === id)
    // 与普通会话 session.markUnread 同口径：没有 event 标记时 PC 走"权威已读位"分支，未读会被立刻抹掉。
    expect(payload).toMatchObject({ sessionId: id, data: { event: 'marked_unread' } })
    expect(typeof payload?.data.last_read_at).toBe('string')
    // 黄点与团队徽标走 stats 链路：标未读后线/项目计数必须立刻体现这条线的未读。
    expect(teamService.listConversations(fixture.team.id)[0].unread).toBe(true)
    const stats = projectSessionStatsStore.list(() => false).find(row => row.projectId === fixture.projectId)
    expect(stats?.unreadCount).toBeGreaterThan(0)
    expect(stats?.teams?.[0]?.unreadCount).toBeGreaterThan(0)
  })
  test('reading one line preserves unseen lines and uses latest member message time', () => {
    const fixture = createTeamFixture()
    const second = teamService.createConversation(fixture.team.id, 'second')
    const firstId = fixture.firstConversation.master_session_id
    const secondId = second.conversation.master_session_id
    const time = '2030-01-01T01:00:00.000Z'
    const first = messageStore.append(firstId, { role: 'agent', content: 'first', status: 'completed', timestamp: time, completedAt: time })
    messageStore.append(secondId, { role: 'agent', content: 'second', status: 'completed', timestamp: time, completedAt: time })
    for (const id of [firstId, secondId]) { sessionStore.markRead(id, '2020-01-01T00:00:00.000Z'); sessionStore.touch(id, time) }
    markTeamConversationRead(fixture.firstConversation.id, [{ sessionId: firstId, messageId: first.id }])
    const lines = teamService.listConversations(fixture.team.id)
    expect(lines.find(line => line.id === fixture.firstConversation.id)).toMatchObject({ unread: false, last_message_at: time })
    expect(lines.find(line => line.id === second.conversation.id)?.unread).toBe(true)
    const stats = projectSessionStatsStore.list(id => id === firstId).find(row => row.projectId === fixture.projectId)
    // 按线计数：第一条线在跑、第二条线未读 → 项目级同时体现 1 在跑 + 1 未读（旧口径只算团队整体一次）。
    expect(stats).toMatchObject({
      runningCount: 1,
      unreadCount: 1,
      teams: [expect.objectContaining({ unread: true, runningCount: 1, unreadCount: 1, total: 2 })],
    })
    expect(projectSessionStatsStore.list().find(row => row.projectId === fixture.projectId)?.unreadCount).toBe(1)
  })

  test('stale loaded messages cannot acknowledge a later reply or another conversation', () => {
    const fixture = createTeamFixture()
    const id = fixture.firstConversation.master_session_id
    const old = messageStore.append(id, { role: 'agent', content: 'old', status: 'completed', timestamp: '2030-01-01T00:00:00.000Z', completedAt: '2030-01-01T00:00:00.000Z' })
    messageStore.append(id, { role: 'agent', content: 'new', status: 'completed', timestamp: '2030-01-02T00:00:00.000Z', completedAt: '2030-01-02T00:00:00.000Z' })
    sessionStore.touch(id, '2030-01-02T00:00:00.000Z')
    markTeamConversationRead(fixture.firstConversation.id, [{ sessionId: id, messageId: old.id }])
    expect(teamService.listConversations(fixture.team.id)[0].unread).toBe(true)
    const second = teamService.createConversation(fixture.team.id, 'second')
    expect(() => markTeamConversationRead(second.conversation.id, [{ sessionId: id, messageId: old.id }])).toThrow()
    const before = sessionStore.get(id)?.last_read_at
    expect(() => markTeamConversationRead(fixture.firstConversation.id, [{ sessionId: id, messageId: old.id }, { sessionId: 'other', messageId: old.id }])).toThrow()
    expect(sessionStore.get(id)?.last_read_at).toBe(before)
  })
  test('counts each conversation line separately and preserves ordinary sessions', () => {
    const fixture = createTeamFixture()
    teamService.createConversation(fixture.team.id, 'second')
    const leaderId = sessionStore.get(fixture.firstConversation.master_session_id)!.agent_id
    const solo = sessionStore.create({ agentId: leaderId, projectId: fixture.projectId })
    const stats = projectSessionStatsStore.list(() => true).find(row => row.projectId === fixture.projectId)
    // 2 条线在跑 + 1 个普通会话在跑 = 3（团队按会话线算，不再整体算 1）
    expect(stats?.runningCount).toBe(3)
    expect(stats?.sessionCount).toBe(3)
    const summary = stats?.teams[0]
    expect(summary).toMatchObject({ running: true, runningCount: 2, unreadCount: 0, total: 2 })
    expect(solo).toBeTruthy()
  })
  test('aggregates a running member grid into the conversation line', () => {
    const fixture = createTeamFixture()
    const members = teamService.conversationDetail(fixture.firstConversation.id).members
    const memberGridId = members.find((member) => member.role !== 'leader')?.session_id
    expect(memberGridId).toBeTruthy()
    messageStore.append(memberGridId as string, { role: 'agent', content: '成员执行中...', status: 'running' })

    const lines = teamService.listConversations(fixture.team.id)
    expect(lines).toHaveLength(1)
    expect(lines[0]?.activity_state).toBe('running')
    expect(lines[0]?.grid_session_ids).toContain(memberGridId)
  })

  test('reports idle when every grid is idle', () => {
    const fixture = createTeamFixture()
    const lines = teamService.listConversations(fixture.team.id)
    expect(lines).toHaveLength(1)
    expect(lines[0]?.activity_state).toBe('idle')
    expect(lines[0]?.grid_session_ids.length).toBeGreaterThan(0)
  })

  test('treats an active master prompt as the line running', () => {
    const fixture = createTeamFixture()
    const masterSessionId = teamService.listConversations(fixture.team.id)[0]?.master_session_id as string
    const lines = teamService.listConversations(fixture.team.id, (sessionId) => sessionId === masterSessionId)
    expect(lines[0]?.activity_state).toBe('running')
  })

  test('keeps grids separate between lines and counts each line', () => {
    const fixture = createTeamFixture()
    teamService.createConversation(fixture.team.id, '第二条线')

    const lines = teamService.listConversations(fixture.team.id)
    expect(lines).toHaveLength(2)
    const firstLine = lines.find((line) => line.id === fixture.firstConversation.id)
    expect(firstLine?.grid_session_ids).not.toContain(lines.find((line) => line.id !== fixture.firstConversation.id)?.master_session_id)

    // 团队按会话线计入项目统计：2 条线 + 团队领袖自身 1 个普通会话（非网格）= 3
    const stats = projectSessionStatsStore.list().find((entry) => entry.projectId === fixture.projectId)
    expect(stats?.sessionCount).toBe(3)
    expect(stats?.runningCount).toBe(0)
    expect(stats?.teams[0]).toMatchObject({ runningCount: 0, unreadCount: 0, total: 2 })
  })

  test('returns a left line member session to the ordinary pool instead of counting it nowhere', () => {
    const fixture = createTeamFixture()
    const member = teamService.conversationDetail(fixture.firstConversation.id).members.find((entry) => entry.role !== 'leader')
    const memberSessionId = member?.session_id as string
    const memberAgentId = member?.agent_id as string
    expect(memberSessionId).toBeTruthy()

    // 当前产品流程里成员 agent 都是 teamInternal（会被独立规则排除），这里先清掉该标记，
    // 让"格子归属"成为唯一变量，才能验证 left_at 谓词本身。
    agentStore.update(memberAgentId, { config: { teamInternal: false } })

    // 成员仍在会话线内：其格子从普通计数排除 → 项目只统计 1 个普通会话 + 1 条团队线
    const before = projectSessionStatsStore.list().find((entry) => entry.projectId === fixture.projectId)
    expect(before?.sessionCount).toBe(2)

    // 目前没有"退出会话线"的生产写入路径（left_at 只在插入时为 NULL）；这里直接置位锁定语义：
    // 已退出的格子必须回归普通池，而不是团队网格与普通计数两边都不算。
    const updated = getDb().prepare('UPDATE team_conversation_members SET left_at = ? WHERE session_id = ?')
      .run('2030-01-01T00:00:00.000Z', memberSessionId)
    expect(updated.changes).toBe(1)

    const after = projectSessionStatsStore.list().find((entry) => entry.projectId === fixture.projectId)
    expect(after?.sessionCount).toBe(3)
    expect(after?.teams[0]).toMatchObject({ total: 1 })
  })

  test('excludes teamInternal agent sessions from project stats', () => {
    const fixture = createTeamFixture()
    const internalAgent = agentStore.create({ name: 'Internal', type: 'dev', runtime: 'mock', projectId: fixture.projectId })
    agentStore.update(internalAgent.id, { config: { teamInternal: true } })
    sessionStore.create({ agentId: internalAgent.id, projectId: fixture.projectId })

    const stats = projectSessionStatsStore.list().find((entry) => entry.projectId === fixture.projectId)
    expect(stats?.sessionCount).toBe(2)
  })
})

describe('team line counts (badge 口径)', () => {
  function markGridRunning(sessionId: string): void {
    messageStore.append(sessionId, { role: 'agent', content: '执行中...', status: 'running' })
  }

  test('counts running lines one by one and a line with two running grids as one', () => {
    const fixture = createTeamFixture()
    const firstMaster = fixture.firstConversation.master_session_id
    const firstMemberGrid = teamService.conversationDetail(fixture.firstConversation.id).members
      .find((entry) => entry.role !== 'leader')?.session_id as string

    // 场景⑤：一条线内 master + 成员双格子同时 running → 仍只算 1 条在跑线
    markGridRunning(firstMaster)
    markGridRunning(firstMemberGrid)
    let summary = listTeamActivity(() => false, fixture.team.id)[0]
    expect(summary).toMatchObject({ runningCount: 1, unreadCount: 0, total: 1, running: true })

    // 场景①②：再开一条线并让它在跑 → 在跑线数=2（用户预期"2 个会话在跑=2"）
    const second = teamService.createConversation(fixture.team.id, '第二条线')
    markGridRunning(second.conversation.master_session_id)
    summary = listTeamActivity(() => false, fixture.team.id)[0]
    expect(summary).toMatchObject({ runningCount: 2, unreadCount: 0, total: 2 })
  })

  test('reports unread lines only when they are not running', () => {
    const fixture = createTeamFixture()
    const second = teamService.createConversation(fixture.team.id, '第二条线')
    for (const id of [fixture.firstConversation.master_session_id, second.conversation.master_session_id]) {
      sessionStore.touch(id, '2030-01-01T00:00:00.000Z')
      sessionStore.markRead(id, '2020-01-01T00:00:00.000Z')
    }
    // 两条线都未读、都未在跑 → 未读线数=2
    let summary = listTeamActivity(() => false, fixture.team.id)[0]
    expect(summary).toMatchObject({ runningCount: 0, unreadCount: 2, total: 2, unread: true })

    // 场景③：其中一条线转为在跑 → running 优先，该线不再计未读
    markGridRunning(fixture.firstConversation.master_session_id)
    summary = listTeamActivity(() => false, fixture.team.id)[0]
    expect(summary).toMatchObject({ runningCount: 1, unreadCount: 1 })
  })

  test('keeps archived lines in the total but out of running/unread counts', () => {
    const fixture = createTeamFixture()
    const second = teamService.createConversation(fixture.team.id, '第二条线')
    markGridRunning(second.conversation.master_session_id)
    expect(listTeamActivity(() => false, fixture.team.id)[0]).toMatchObject({ runningCount: 1, total: 2 })

    // 场景⑥：归档在跑的线 → 徽标不再亮绿；总数仍与团队聊天列表可见线数一致（含已归档）
    teamService.archiveConversation(second.conversation.id)
    const summary = listTeamActivity(() => false, fixture.team.id)[0]
    expect(summary).toMatchObject({ runningCount: 0, running: false, total: 2 })
  })

  test('counts every idle line into the total so the badge shows the list length', () => {
    const fixture = createTeamFixture()
    teamService.createConversation(fixture.team.id, '第二条线')
    teamService.createConversation(fixture.team.id, '第三条线')

    // 场景④：全部空闲 → running/unread 都是 0，总数 = 打开团队看到的线数（灰点 + 3）
    const summary = listTeamActivity(() => false, fixture.team.id)[0]
    expect(summary).toMatchObject({ runningCount: 0, unreadCount: 0, total: 3, running: false, unread: false })
    expect(summary?.conversations).toHaveLength(3)
  })

  test('counts lines whose grid sessions are all closed in the total', () => {    const fixture = createTeamFixture()
    const second = teamService.createConversation(fixture.team.id, '第二条线')
    // 把第二条线的所有格子 session 关闭：该线不应在 conversations[]（无活跃格子），但必须计入总数
    for (const id of [second.conversation.master_session_id, ...(teamService.conversationDetail(second.conversation.id).members.map((entry) => entry.session_id).filter(Boolean) as string[])]) {
      sessionStore.updateStatus(id, 'closed')
    }
    const summary = listTeamActivity(() => false, fixture.team.id)[0]
    expect(summary?.conversations.some((line) => line.conversationId === second.conversation.id)).toBe(false)
    expect(summary).toMatchObject({ runningCount: 0, unreadCount: 0, total: 2 })
  })
})

function createTeamFixture() {
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
  teamService.spawnMember({ teamId: created.team.id, agentId: worker.id, name: 'Worker' })
  const firstConversation = teamService.createConversation(created.team.id, '首线')
  return { projectId: project.id, team: created.team, firstConversation: firstConversation.conversation }
}
