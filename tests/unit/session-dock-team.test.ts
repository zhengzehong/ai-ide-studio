import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { teamService } from '../../src/core/teams.js'
import { globalSessionDockStore } from '../../src/store/global-session-dock.js'
import { listGlobalSessionDockItems } from '../../src/queries/global-session-dock-query.js'
import { projectTeamDockItems } from '../../ui/src/components/session-dock/session-dock-team'
import type { SessionDockItem } from '../../ui/src/stores/session-dock.store'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-dock-team-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

function createLine() {
  const project = projectStore.create({ name: 'P', workDir: tmp })
  const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
  const leaderSession = sessionStore.create({ agentId: leader.id, projectId: project.id })
  const created = teamService.create({ projectId: project.id, leaderAgentId: leader.id, leaderSessionId: leaderSession.id, name: 'Alpha' })
  const line = teamService.createConversation(created.team.id, '首线')
  const masterSessionId = line.conversation.master_session_id
  sessionStore.touch(masterSessionId, '2030-01-01T00:00:00.000Z')
  return { projectId: project.id, teamId: created.team.id, line: line.conversation, masterSessionId }
}

describe('global Session dock team identity (server)', () => {
  test('annotates a docked master session with its team line and leaves ordinary sessions bare', () => {
    const fixture = createLine()
    const ordinary = agentStore.create({ name: 'Solo', type: 'dev', runtime: 'mock', projectId: fixture.projectId })
    const ordinarySession = sessionStore.create({ agentId: ordinary.id, projectId: fixture.projectId })
    globalSessionDockStore.add(fixture.masterSessionId)
    globalSessionDockStore.add(ordinarySession.id)

    const items = listGlobalSessionDockItems(() => false)
    const teamItem = items.find(item => item.sessionId === fixture.masterSessionId)
    expect(teamItem).toMatchObject({
      teamId: fixture.teamId,
      teamName: 'Alpha',
      teamConversationId: fixture.line.id,
      teamConversationTitle: '首线',
      teamConversationStatus: 'active',
    })
    expect(items.find(item => item.sessionId === ordinarySession.id)).toMatchObject({
      teamId: null,
      teamConversationId: null,
    })
  })

  test('exposes the master-session reverse lookup for deep links', () => {
    const fixture = createLine()
    expect(teamService.conversationByMasterSession(fixture.masterSessionId)).toMatchObject({
      id: fixture.line.id,
      master_session_id: fixture.masterSessionId,
      team_id: fixture.teamId,
    })
    // 成员格子 session 不是线入口：深链仍走普通会话视图，避免"链接指成员却跳团队线"。
    const memberGrid = teamService.listConversations(fixture.teamId)[0].grid_session_ids.find(id => id !== fixture.masterSessionId)
    if (memberGrid) expect(teamService.conversationByMasterSession(memberGrid)).toBeNull()
    expect(teamService.conversationByMasterSession('missing-session')).toBeNull()
  })

  test('stops resolving archived lines and archived teams', () => {
    const fixture = createLine()
    teamService.archiveConversation(fixture.line.id)
    expect(teamService.conversationByMasterSession(fixture.masterSessionId)).toBeNull()
  })
})

describe('global Session dock team projection (PC)', () => {
  const item: SessionDockItem = {
    sessionId: 'master-1',
    sessionTitle: 'Leader 会话',
    stage: '',
    agentId: 'agent-1',
    agentName: 'Leader',
    agentIcon: 'code',
    agentAvatarUrl: null,
    projectId: 'p1',
    projectName: 'AI IDE Studio',
    projectColor: null,
    projectIcon: null,
    activityState: 'idle',
    unread: false,
    lastActivityAt: '2030-01-01T00:00:00.000Z',
    sortOrder: 1,
    addedAt: '2030-01-01T00:00:00.000Z',
    teamId: 't1',
    teamName: 'Alpha',
    teamConversationId: 'tc1',
    teamConversationTitle: '首线',
    teamConversationStatus: 'active',
  }
  const stats = {
    p1: {
      projectId: 'p1',
      runningCount: 1,
      unreadCount: 1,
      teams: [{ teamId: 't1', projectId: 'p1', running: true, unread: true, conversations: [{ conversationId: 'tc1', running: true, unread: true, lastMessageAt: '2030-02-02T00:00:00.000Z', sessionIds: ['master-1', 'grid-2'] }] }],
    },
  }

  test('renders a docked team line as a team entry with line-level activity', () => {
    const [projected] = projectTeamDockItems([item], stats)
    expect(projected).toMatchObject({
      sessionId: 'master-1',
      agentId: 't1',
      agentName: 'Alpha',
      sessionTitle: '首线',
      activityState: 'running',
      unread: true,
      lastActivityAt: '2030-02-02T00:00:00.000Z',
    })
  })

  test('falls back to session-level state when the line activity snapshot is missing', () => {
    const [projected] = projectTeamDockItems([item], {})
    expect(projected).toMatchObject({ agentName: 'Alpha', sessionTitle: '首线', activityState: 'idle', unread: false })
  })

  test('leaves ordinary and archived-line rows untouched', () => {
    const ordinary = projectTeamDockItems([{ ...item, teamId: null, teamConversationId: null, teamConversationStatus: null }], stats)[0]
    expect(ordinary).toMatchObject({ agentName: 'Leader', sessionTitle: 'Leader 会话' })
    const archived = projectTeamDockItems([{ ...item, teamConversationStatus: 'archived' }], stats)[0]
    expect(archived).toMatchObject({ agentName: 'Leader', sessionTitle: 'Leader 会话' })
  })
})
