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
import { sendTeamMailboxHandler } from '../../src/tools/handlers/team/team-tools.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-mailbox-wake-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('team mailbox wake eligibility', () => {
  test('member default-type message bound to a task schedules a leader wake', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createTeamFixture()

    teamService.sendMailbox({
      teamId: fixture.team.id,
      type: 'message',
      content: '任务已完成，改动在 worktree，等你合并指示',
      fromMemberId: fixture.member.id,
      taskId: fixture.task.id,
    })
    expect(enqueue).not.toHaveBeenCalled()

    vi.advanceTimersByTime(15_100)

    expect(enqueue).toHaveBeenCalledTimes(1)
    const [sessionId, prompt] = enqueue.mock.calls[0]
    expect(sessionId).toBe(fixture.leaderSessionId)
    expect(String(prompt)).toContain('系统通知')
    expect(String(prompt)).toContain('等你合并指示')
  })

  test('default-type message without a task stays silent', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createTeamFixture()

    teamService.sendMailbox({
      teamId: fixture.team.id,
      type: 'message',
      content: '随便聊聊',
      fromMemberId: fixture.member.id,
    })

    vi.advanceTimersByTime(20_000)

    expect(enqueue).not.toHaveBeenCalled()
  })

  test('task-bound message and task completion merge into a single wake', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createTeamFixture()

    teamService.sendMailbox({
      teamId: fixture.team.id,
      type: 'message',
      content: '做完了',
      fromMemberId: fixture.member.id,
      taskId: fixture.task.id,
    })
    const updated = teamService.updateTask({
      teamId: fixture.team.id,
      taskId: fixture.task.id,
      status: '已完成',
      actor: { teamMemberId: fixture.member.id },
    })
    expect(updated.status).toBe('completed')

    vi.advanceTimersByTime(17_200)

    expect(enqueue).toHaveBeenCalledTimes(1)
    const [, prompt] = enqueue.mock.calls[0]
    expect(String(prompt)).toContain('Status: completed')
  })

  test('leader-sent task-bound message stays silent', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createTeamFixture()
    const leader = teamService.listMembers(fixture.team.id).find((item) => item.role === 'leader')

    teamService.sendMailbox({
      teamId: fixture.team.id,
      type: 'message',
      content: 'Master 留言',
      fromMemberId: leader!.id,
      taskId: fixture.task.id,
    })

    vi.advanceTimersByTime(20_000)

    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('team.mailbox.send default type', () => {
  test('defaults to report when taskId is present and message otherwise', async () => {
    const fixture = createTeamFixture()
    const context = { sessionId: fixture.memberSession.id }

    await sendTeamMailboxHandler.execute(
      { teamId: fixture.team.id, content: '完成汇报', taskId: fixture.task.id },
      context,
    )
    await sendTeamMailboxHandler.execute(
      { teamId: fixture.team.id, content: '纯留言' },
      context,
    )

    const messages = teamService.listMailbox(fixture.team.id)
    expect(messages.at(-2)?.type).toBe('report')
    expect(messages.at(-1)?.type).toBe('message')
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
  const spawn = teamService.spawnMember({ teamId: created.team.id, agentId: worker.id, name: 'Worker' })
  const task = teamService.createTask({ teamId: created.team.id, title: '实现一个小功能', assigneeMemberId: spawn.member.id })
  return { team: created.team, member: spawn.member, memberSession: spawn.session, task, leaderSessionId: created.session.id }
}
