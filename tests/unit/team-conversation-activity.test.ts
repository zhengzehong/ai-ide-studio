import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import { teamService } from '../../src/core/teams.js'
import { projectSessionStatsStore } from '../../src/store/session-stats.js'
import { markTeamConversationRead } from '../../src/core/team-conversation-read.js'

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
    expect(stats).toMatchObject({ runningCount: 1, unreadCount: 0, teams: [expect.objectContaining({ unread: true })] })
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
  test('counts many running grids and lines as one team, preserving ordinary sessions', () => {
    const fixture = createTeamFixture()
    teamService.createConversation(fixture.team.id, 'second')
    const leaderId = sessionStore.get(fixture.firstConversation.master_session_id)!.agent_id
    const solo = sessionStore.create({ agentId: leaderId, projectId: fixture.projectId })
    const stats = projectSessionStatsStore.list(() => true).find(row => row.projectId === fixture.projectId)
    expect(stats?.runningCount).toBe(2)
    expect(stats?.sessionCount).toBe(2)
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

  test('keeps grids separate between lines but counts their team once', () => {
    const fixture = createTeamFixture()
    teamService.createConversation(fixture.team.id, '第二条线')

    const lines = teamService.listConversations(fixture.team.id)
    expect(lines).toHaveLength(2)
    const firstLine = lines.find((line) => line.id === fixture.firstConversation.id)
    expect(firstLine?.grid_session_ids).not.toContain(lines.find((line) => line.id !== fixture.firstConversation.id)?.master_session_id)

    // Multiple conversation lines belong to one outward team unit.
    const stats = projectSessionStatsStore.list().find((entry) => entry.projectId === fixture.projectId)
    expect(stats?.sessionCount).toBe(1)
    expect(stats?.runningCount).toBe(0)
  })

  test('excludes teamInternal agent sessions from project stats', () => {
    const fixture = createTeamFixture()
    const internalAgent = agentStore.create({ name: 'Internal', type: 'dev', runtime: 'mock', projectId: fixture.projectId })
    agentStore.update(internalAgent.id, { config: { teamInternal: true } })
    sessionStore.create({ agentId: internalAgent.id, projectId: fixture.projectId })

    const stats = projectSessionStatsStore.list().find((entry) => entry.projectId === fixture.projectId)
    expect(stats?.sessionCount).toBe(1)
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
