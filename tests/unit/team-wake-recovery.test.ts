import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase, getDb } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { teamMailboxStore } from '../../src/store/teams.js'
import { teamService } from '../../src/core/teams.js'
import { reconcilePendingTeamWakes } from '../../src/core/team-reconcile.js'
import { sessionManager } from '../../src/core/sessions.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-wake-recovery-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('reconcilePendingTeamWakes', () => {
  test('re-wakes the leader for a recent task-less report lost to a restart', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createTeamFixture()
    seedReport(fixture, { content: '纯汇报：子任务已完成，无需任务记录' })

    const result = reconcilePendingTeamWakes()
    expect(result.recovered).toBe(1)

    vi.advanceTimersByTime(2_100)
    expect(enqueue).toHaveBeenCalledTimes(1)
    const [sessionId, prompt, images, options] = enqueue.mock.calls[0]
    expect(sessionId).toBe(fixture.leaderSessionId)
    expect(String(prompt)).toContain('纯汇报：子任务已完成，无需任务记录')
    expect(images).toBeUndefined()
    expect(options).toMatchObject({ senderRole: 'team-system', senderName: '系统' })
  })

  test('skips recovery when the leader session already has activity after the report', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createTeamFixture()
    seedReport(fixture, { content: '已被处理的汇报' })
    // Leader 会话在汇报之后已有动静（唤醒已发生过或用户已介入）→ 不重复唤醒。
    getDb()
      .prepare('UPDATE sessions SET last_message_at = ? WHERE id = ?')
      .run(new Date(Date.now() + 60_000).toISOString(), fixture.leaderSessionId)

    expect(reconcilePendingTeamWakes().recovered).toBe(0)
    vi.advanceTimersByTime(2_100)
    expect(enqueue).not.toHaveBeenCalled()
  })

  test('skips task-bound reports; those are covered by the task reconcile', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createTeamFixture()
    seedReport(fixture, { content: '绑任务的汇报', taskId: fixture.task.id })

    expect(reconcilePendingTeamWakes().recovered).toBe(0)
    vi.advanceTimersByTime(2_100)
    expect(enqueue).not.toHaveBeenCalled()
  })

  test('ignores reports older than the recovery window', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createTeamFixture()
    seedReport(fixture, { content: '很久以前的汇报', createdOffsetMs: -(11 * 60 * 1000) })

    expect(reconcilePendingTeamWakes().recovered).toBe(0)
    vi.advanceTimersByTime(2_100)
    expect(enqueue).not.toHaveBeenCalled()
  })

  test('does not stack a second wake when one is already pending for the leader', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    const isPromptActive = vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createTeamFixture()
    seedReport(fixture, { content: '与任务对账同时存在的汇报' })

    // 模拟任务对账已经排了一个唤醒。
    teamService.updateTask({ teamId: fixture.team.id, taskId: fixture.task.id, status: 'needs_input', actor: { teamMemberId: fixture.member.id } })
    expect(reconcilePendingTeamWakes().recovered).toBe(0)

    vi.advanceTimersByTime(2_100)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(String(enqueue.mock.calls[0]?.[1])).toContain('needs_input')
    expect(isPromptActive).toHaveBeenCalled()
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
  return { team: created.team, member, task, leaderSessionId: created.session.id }
}

/** 直接落一条 mailbox 行，模拟"崩溃前已持久化、唤醒定时器没来得及触发"。 */
function seedReport(
  fixture: ReturnType<typeof createTeamFixture>,
  options: { content: string; taskId?: string; createdOffsetMs?: number },
) {
  const message = teamMailboxStore.create({
    teamId: fixture.team.id,
    projectId: fixture.team.project_id,
    fromMemberId: fixture.member.id,
    taskId: options.taskId,
    type: 'report',
    content: options.content,
  })
  if (options.createdOffsetMs) {
    getDb()
      .prepare('UPDATE team_mailbox SET created_at = ? WHERE id = ?')
      .run(new Date(Date.now() + options.createdOffsetMs).toISOString(), message.id)
  }
  return message
}
