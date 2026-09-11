import { afterEach, beforeEach, expect, test, vi } from 'vitest'
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

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'team-dispatch-failure-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
  vi.useFakeTimers()
  vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

function createFixture(): { teamId: string; memberId: string; firstMaster: string; secondMaster: string } {
  const project = projectStore.create({ name: 'P', workDir: tmp })
  const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
  const worker = agentStore.create({ name: 'Worker', type: 'dev', runtime: 'mock', projectId: project.id })
  const leaderSession = sessionStore.create({ agentId: leader.id, projectId: project.id })
  const { team } = teamService.create({
    projectId: project.id, leaderAgentId: leader.id, leaderSessionId: leaderSession.id, name: 'Alpha',
  })
  const first = teamService.createConversation(team.id)
  const { member } = teamService.spawnMember({ teamId: team.id, agentId: worker.id })
  const second = teamService.createConversation(team.id)
  return {
    teamId: team.id, memberId: member.id,
    firstMaster: first.conversation.master_session_id,
    secondMaster: second.conversation.master_session_id,
  }
}

test.each(['running', 'completed', 'cancelled', 'needs_input'] as const)(
  'notifies the dispatch conversation Master and preserves a %s task appropriately', async (status) => {
    const fixture = createFixture()
    const task = teamService.createTask({
      teamId: fixture.teamId, title: '验证任务', assigneeMemberId: fixture.memberId,
      sourceSessionId: fixture.firstMaster,
    })
    taskStore.update(task.id, { status, stage: '之前的阶段' })
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt')
      .mockRejectedValueOnce(new Error('会话不存在')).mockResolvedValue()

    teamService.dispatchMessage({
      teamId: fixture.teamId, memberId: fixture.memberId, taskId: task.id,
      sourceSessionId: fixture.secondMaster, content: '本会话的派发',
    })
    await vi.advanceTimersByTimeAsync(2100)

    expect(enqueue).toHaveBeenCalledTimes(2)
    const [sessionId, prompt, , options] = enqueue.mock.calls[1]
    expect(sessionId).toBe(fixture.secondMaster)
    expect(sessionId).not.toBe(fixture.firstMaster)
    expect(prompt).toContain('派发失败')
    expect(prompt).toContain('会话不存在')
    expect(prompt).toContain(task.id)
    expect(options).toMatchObject({ senderRole: 'team-system', senderName: '系统' })
    expect(taskStore.get(task.id)?.status).toBe(status === 'running' ? 'needs_input' : status)
    expect(taskStore.get(task.id)?.stage).toBe(status === 'running' ? '派发失败:会话不存在' : '之前的阶段')
  },
)

test('notifies the Master when a dispatch without a task fails', async () => {
  const fixture = createFixture()
  const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt')
    .mockRejectedValueOnce(new Error('会话已归档')).mockResolvedValue()
  teamService.dispatchMessage({
    teamId: fixture.teamId, memberId: fixture.memberId,
    sourceSessionId: fixture.secondMaster, content: '补充调研',
  })
  await vi.advanceTimersByTimeAsync(2100)
  expect(enqueue).toHaveBeenCalledTimes(2)
  expect(enqueue.mock.calls[1][0]).toBe(fixture.secondMaster)
  expect(enqueue.mock.calls[1][1]).toContain('会话已归档')
})

test('delivers a failure notice after a busy Master finishes cleanup, even beyond the wake delay', async () => {
  const fixture = createFixture()
  const isActive = vi.mocked(sessionManager.isPromptActive)
    .mockImplementation((id) => id === fixture.secondMaster)
  const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt')
    .mockRejectedValueOnce(new Error('会话不存在')).mockResolvedValue()
  teamService.dispatchMessage({
    teamId: fixture.teamId, memberId: fixture.memberId,
    sourceSessionId: fixture.secondMaster, content: '需要回调',
  })
  await vi.advanceTimersByTimeAsync(2100)
  events.emit('session:done', { sessionId: fixture.secondMaster })
  await vi.advanceTimersByTimeAsync(2100)
  expect(enqueue).toHaveBeenCalledTimes(1)
  isActive.mockReturnValue(false)
  events.emit('session:activity', {
    sessionId: fixture.secondMaster, agentId: 'master', state: 'idle',
    reason: 'prompt-done', timestamp: new Date().toISOString(),
  })
  await vi.advanceTimersByTimeAsync(2100)
  expect(enqueue).toHaveBeenCalledTimes(2)
  expect(enqueue.mock.calls[1][0]).toBe(fixture.secondMaster)
})

test('keeps Master wakes serial and resumes on settlement without a done event', async () => {
  const fixture = createFixture()
  let resolveWake!: () => void
  const firstWake = new Promise<void>((resolve) => { resolveWake = resolve })
  const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt')
    .mockRejectedValueOnce(new Error('第一次派发失败'))
    .mockReturnValueOnce(firstWake)
    .mockRejectedValueOnce(new Error('第二次派发失败'))
    .mockResolvedValue()
  const dispatch = (): void => {
    teamService.dispatchMessage({
      teamId: fixture.teamId, memberId: fixture.memberId,
      sourceSessionId: fixture.secondMaster, content: '工作',
    })
  }
  try {
    dispatch()
    await vi.advanceTimersByTimeAsync(2100)
    expect(enqueue).toHaveBeenCalledTimes(2)
    dispatch()
    events.emit('session:done', { sessionId: fixture.secondMaster })
    events.emit('session:activity', {
      sessionId: fixture.secondMaster, agentId: 'master', state: 'idle',
      reason: 'prompt-done', timestamp: new Date().toISOString(),
    })
    await vi.advanceTimersByTimeAsync(2100)
    expect(enqueue).toHaveBeenCalledTimes(3)
  } finally {
    resolveWake()
    await vi.advanceTimersByTimeAsync(2100)
  }
  expect(enqueue).toHaveBeenCalledTimes(4)
  expect(enqueue.mock.calls[3][0]).toBe(fixture.secondMaster)
  expect(enqueue.mock.calls[3][1]).toContain('第二次派发失败')
})
