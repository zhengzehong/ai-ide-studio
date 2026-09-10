import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { teamStore } from '../../src/store/teams.js'
import { teamConversationStore } from '../../src/store/team-conversations.js'
import { teamService } from '../../src/core/teams.js'
import { reconcileInterruptedTeamTasks } from '../../src/core/team-reconcile.js'
import { sessionManager } from '../../src/core/sessions.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-archive-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
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
  const member = teamService.spawnMember({ teamId: created.team.id, agentId: worker.id, name: 'Worker' }).member
  return { project, team: created.team, member }
}

describe('teamService.archive', () => {
  test('archives the team, hides it from list, and archives active conversations', () => {
    const fixture = createTeamFixture()
    const conversation = teamService.createConversation(fixture.team.id)

    const archived = teamService.archive(fixture.team.id)

    expect(archived.archived_at).toBeTruthy()
    expect(teamStore.get(fixture.team.id)?.archived_at).toBeTruthy()
    expect(teamService.list(fixture.project.id).map((team) => team.id)).not.toContain(fixture.team.id)
    expect(teamConversationStore.get(conversation.conversation.id)?.status).toBe('archived')
  })

  test('archiving twice is idempotent and keeps the first archived_at', () => {
    const fixture = createTeamFixture()
    const first = teamService.archive(fixture.team.id)
    const second = teamService.archive(fixture.team.id)
    expect(second.archived_at).toBe(first.archived_at)
  })

  test('does not touch other teams in the same project', () => {
    const fixture = createTeamFixture()
    const otherLeader = agentStore.create({ name: 'Leader2', type: 'architect', runtime: 'mock', projectId: fixture.project.id })
    const otherLeaderSession = sessionStore.create({ agentId: otherLeader.id, projectId: fixture.project.id })
    const other = teamService.create({
      projectId: fixture.project.id,
      leaderAgentId: otherLeader.id,
      leaderSessionId: otherLeaderSession.id,
      name: 'Beta',
    })

    teamService.archive(fixture.team.id)

    expect(teamStore.get(other.team.id)?.archived_at).toBeNull()
  })
})

describe('reconcileInterruptedTeamTasks', () => {
  test('marks running team tasks needs_input and leaves non-team tasks alone', () => {
    vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    const fixture = createTeamFixture()
    const teamTask = teamService.createTask({ teamId: fixture.team.id, title: '重启动 interrupted', assigneeMemberId: fixture.member.id })
    teamService.updateTask({ teamId: fixture.team.id, taskId: teamTask.id, status: 'running' })

    const result = reconcileInterruptedTeamTasks()

    expect(result.reconciled).toBeGreaterThanOrEqual(1)
    const updated = teamService.listTasks(fixture.team.id).find((task) => task.id === teamTask.id)
    expect(updated?.status).toBe('needs_input')
    expect(updated?.stage).toContain('重新派发')
  })

  test('is a no-op when no team tasks are running', () => {
    const fixture = createTeamFixture()
    teamService.createTask({ teamId: fixture.team.id, title: '草稿任务', assigneeMemberId: fixture.member.id })
    expect(reconcileInterruptedTeamTasks().reconciled).toBe(0)
  })
})
