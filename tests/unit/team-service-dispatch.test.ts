import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { taskStore } from '../../src/store/tasks.js'
import { teamService } from '../../src/core/teams.js'
import { sessionManager } from '../../src/core/sessions.js'
import { events } from '../../src/core/events.js'
import type { AppEvents } from '../../src/core/events.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-dispatch-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('team dispatch lifecycle', () => {
  test('marks backlog task as executing when leader dispatches it to a member', () => {
    vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    const fixture = createTeamFixture()
    const taskUpdates: string[] = []
    const onTaskUpdate = ((ev: AppEvents['task:update']) => taskUpdates.push(ev.taskId))
    events.on('task:update', onTaskUpdate)

    try {
      teamService.dispatchMessage({
        teamId: fixture.team.id,
        memberId: fixture.member.id,
        content: '请完成这个任务',
        taskId: fixture.task.id,
      })

      const updated = taskStore.get(fixture.task.id)
      expect(updated).toMatchObject({ status: 'running', assignee_member_id: fixture.member.id })
      expect(updated?.stage).toContain(fixture.member.name)
      expect(taskUpdates).toContain(fixture.task.id)
    } finally {
      events.off('task:update', onTaskUpdate)
    }
  })

  test('does not reopen completed tasks when dispatching follow-up messages', () => {
    vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    const fixture = createTeamFixture()
    teamService.updateTask({ teamId: fixture.team.id, taskId: fixture.task.id, status: 'completed', stage: '已完成' })

    teamService.dispatchMessage({
      teamId: fixture.team.id,
      memberId: fixture.member.id,
      content: '补充说明',
      taskId: fixture.task.id,
    })

    expect(taskStore.get(fixture.task.id)).toMatchObject({ status: 'completed', stage: '已完成' })
  })

  test('emits created member session so clients can add it without a full reload', () => {
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
    const changedSessions: string[] = []
    const onSessionChanged = ((ev: AppEvents['session:changed']) => changedSessions.push(String(ev.data.id)))
    events.on('session:changed', onSessionChanged)

    try {
      const spawned = teamService.spawnMember({ teamId: created.team.id, agentId: worker.id })
      expect(changedSessions).toContain(spawned.session.id)
    } finally {
      events.off('session:changed', onSessionChanged)
    }
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
  const member = teamService.spawnMember({ teamId: created.team.id, agentId: worker.id, name: 'Worker' }).member
  const task = teamService.createTask({ teamId: created.team.id, title: '实现一个小功能', assigneeMemberId: member.id })
  return { team: created.team, member, task }
}
