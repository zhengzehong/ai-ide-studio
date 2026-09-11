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
import { acpHost } from '../../src/acp/host.js'
import type { AppEvents } from '../../src/core/events.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-dispatch-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
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

describe('team dispatch pending queue (FIFO)', () => {
  test('delivers both queued dispatches in order instead of dropping the first', async () => {
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    const isPromptActive = vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(true)
    const fixture = createTeamFixture()

    teamService.dispatchMessage({ teamId: fixture.team.id, memberId: fixture.member.id, content: '第一条指令' })
    teamService.dispatchMessage({ teamId: fixture.team.id, memberId: fixture.member.id, content: '第二条指令' })
    expect(enqueue).not.toHaveBeenCalled()

    events.emit('session:done', { sessionId: fixture.member.session_id })
    expect(enqueue).not.toHaveBeenCalled()
    isPromptActive.mockReturnValue(false)
    events.emit('session:activity', {
      sessionId: fixture.member.session_id, agentId: fixture.member.agent_id,
      state: 'idle', reason: 'prompt-done', timestamp: new Date().toISOString(),
    })
    expect(enqueue.mock.calls[0]?.[1]).toBe('第一条指令')

    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2))
    expect(enqueue.mock.calls[1]?.[1]).toBe('第二条指令')
  })

  test('cancelPendingForSessions drops queued dispatches for archived teams', async () => {
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    const isPromptActive = vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(true)
    const fixture = createTeamFixture()

    teamService.dispatchMessage({ teamId: fixture.team.id, memberId: fixture.member.id, content: '不会被派发' })
    const { cancelPendingForSessions } = await import('../../src/core/team-member-dispatcher.js')
    cancelPendingForSessions([fixture.member.session_id])

    isPromptActive.mockReturnValue(false)
    events.emit('session:activity', {
      sessionId: fixture.member.session_id, agentId: fixture.member.agent_id,
      state: 'idle', reason: 'prompt-done', timestamp: new Date().toISOString(),
    })
    expect(enqueue).not.toHaveBeenCalled()
  })

  test('writes the task back to needs_input when the final dispatch attempt fails', async () => {
    vi.useFakeTimers()
    vi.spyOn(sessionManager, 'enqueuePrompt').mockRejectedValueOnce(new Error('会话不存在')).mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createTeamFixture()

    teamService.dispatchMessage({
      teamId: fixture.team.id,
      memberId: fixture.member.id,
      content: '请完成这个任务',
      taskId: fixture.task.id,
    })

    await vi.advanceTimersByTimeAsync(2100)
    expect(taskStore.get(fixture.task.id)?.status).toBe('needs_input')
    expect(taskStore.get(fixture.task.id)?.stage).toContain('派发失败')
    expect(taskStore.get(fixture.task.id)?.stage).toContain('会话不存在')
  })

  test('drains queued assignments through the real Session cleanup and prompt batcher', async () => {
    const fixture = createTeamFixture()
    let releaseFirst!: () => void
    const firstTurn = new Promise<void>((resolve) => { releaseFirst = resolve })
    const prompts: string[] = []
    const busyAtDone: boolean[] = []
    vi.spyOn(acpHost, 'ensureSession').mockResolvedValue(`acp-${fixture.member.session_id}`)
    vi.spyOn(acpHost, 'prompt').mockImplementation(async (_agentId, _sessionId, content) => {
      prompts.push(content)
      if (prompts.length === 1) await firstTurn
      busyAtDone.push(sessionManager.isPromptActive(fixture.member.session_id))
      events.emit('session:done', { sessionId: fixture.member.session_id })
    })
    const initial = sessionManager.sendPrompt(fixture.member.session_id, '已有工作')
    try {
      await vi.waitFor(() => expect(prompts).toHaveLength(1))
      for (const content of ['下一条', '最后一条']) {
        expect(teamService.dispatchMessage({
          teamId: fixture.team.id, memberId: fixture.member.id, content,
        }).status).toBe('queued')
      }
    } finally {
      releaseFirst()
      await initial
    }
    await vi.waitFor(() => {
      expect(prompts).toHaveLength(3)
      expect(sessionManager.isPromptPending(fixture.member.session_id)).toBe(false)
    })
    expect(prompts[1]).toContain('下一条')
    expect(prompts[2]).toContain('最后一条')
    expect(busyAtDone).toEqual([true, true, true])
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
