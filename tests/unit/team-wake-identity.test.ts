import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { teamService } from '../../src/core/teams.js'
import { sessionManager } from '../../src/core/sessions.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-wake-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('team leader wake identity', () => {
  test('persists the wake prompt as a system notice instead of impersonating the user', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createTeamFixture()

    teamService.updateTask({
      teamId: fixture.team.id,
      taskId: fixture.task.id,
      status: 'completed',
      actor: { teamMemberId: fixture.member.id },
    })
    expect(enqueue).not.toHaveBeenCalled()

    vi.advanceTimersByTime(2_100)

    expect(enqueue).toHaveBeenCalledTimes(1)
    const [sessionId, prompt, images, options] = enqueue.mock.calls[0]
    expect(sessionId).toBe(fixture.leaderSessionId)
    expect(String(prompt)).toContain('系统通知')
    expect(images).toBeUndefined()
    expect(options).toMatchObject({ senderRole: 'team-system', senderName: '系统' })
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
  return { team: created.team, member, task, leaderSessionId: leaderSession.id }
}
