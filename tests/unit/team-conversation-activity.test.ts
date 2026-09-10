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

  test('counts the second line grids neither into the line nor the project stats', () => {
    const fixture = createTeamFixture()
    teamService.createConversation(fixture.team.id, '第二条线')

    const lines = teamService.listConversations(fixture.team.id)
    expect(lines).toHaveLength(2)
    const firstLine = lines.find((line) => line.id === fixture.firstConversation.id)
    expect(firstLine?.grid_session_ids).not.toContain(lines.find((line) => line.id !== fixture.firstConversation.id)?.master_session_id)

    // 第二条线的格子是新建 session（非 primary），不应计入项目统计；首线复用的 primary 格子保留。
    const stats = projectSessionStatsStore.list().find((entry) => entry.projectId === fixture.projectId)
    expect(stats?.sessionCount).toBe(2)
    expect(stats?.runningCount).toBe(0)
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
