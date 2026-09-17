/**
 * 团队邮箱会话线硬隔离 v3（2026-09-17 用户拍板）单测。
 *
 * 覆盖验收清单：
 * 1. 写入归属四级兜底（会话 → 任务 → 成员主格 → 团队默认线）与"全落空拒收"；
 * 2. agent 工具视图按线过滤（team.get / team.mailbox.list / team.task.list / team.status），无全局口子；
 * 3. 唤醒拼接：任务邮件（15s）与任务完成（2s）同窗不再互相覆盖（本案 3 封被吞的回归）；
 * 4. 加固：同线已投递标记、report/result 未绑任务拒收、getBySession 确定化、遗留 NULL 行只在默认线可见。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase, getDb } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { teamConversationStore } from '../../src/store/team-conversations.js'
import { teamMailboxStore, teamMemberStore } from '../../src/store/teams.js'
import { teamService } from '../../src/core/teams.js'
import { teamWakeCoordinator } from '../../src/core/team-wake-coordinator.js'
import { resolveMailboxLine } from '../../src/core/team-line-scope.js'
import { sessionManager } from '../../src/core/sessions.js'
import { getTeamHandler, listTeamMailboxHandler, listTeamTasksHandler, sendTeamMailboxHandler } from '../../src/tools/handlers/team/team-tools.js'
import { getTeamStatusHandler } from '../../src/tools/handlers/team/team-status-tool.js'
import type { ToolContext } from '../../src/tools/types.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-line-scope-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('邮件归属四级兜底', () => {
  test('① 发送会话所在线优先（同团队多线时按会话精确定位）', () => {
    const f = createFixture()
    const { first, second } = createTwoLines(f)

    const message = teamService.sendMailbox({
      teamId: f.teamId, type: 'question', content: '二线提问',
      fromMemberId: f.memberId, sourceSessionId: second.memberSessionId,
    })

    expect(message.conversation_id).toBe(second.conversationId)
    expect(message.conversation_id).not.toBe(first.conversationId)
  })

  test('② 任务 initiator_session_id 所在线优先于成员主格线（任务在二线、成员主格在一线 → 归二线）', () => {
    const f = createFixture()
    const { first, second } = createTwoLines(f)
    const task = teamService.createTask({
      teamId: f.teamId, title: '二线的活', assigneeMemberId: f.memberId, sourceSessionId: second.masterSessionId,
    })

    const resolved = resolveMailboxLine({ teamId: f.teamId, taskId: task.id, fromMemberId: f.memberId })

    expect(resolved).toMatchObject({ conversationId: second.conversationId, via: 'task' })
    expect(resolved?.conversationId).not.toBe(first.conversationId)
  })

  test('③ 成员主格线：无发送会话、无任务时落在成员 primary 所属线（即使它不是默认线）', () => {
    vi.useFakeTimers()
    const f = createFixture()
    const first = createLine(f, '一线')
    vi.advanceTimersByTime(1_000)
    const second = createLine(f, '二线')
    // 把成员 primary 挂到二线（一线是更早创建的默认线）：③ 命中二线才能证明它先于 ④。
    teamConversationStore.addMember(second.conversationId, f.memberId, f.memberPrimarySessionId)

    const resolved = resolveMailboxLine({ teamId: f.teamId, fromMemberId: f.memberId })

    expect(resolved).toMatchObject({ conversationId: second.conversationId, via: 'member-primary' })
    expect(resolved?.conversationId).not.toBe(first.conversationId)
  })

  test('④ 团队默认线：发送会话/任务/成员主格全无 → 落最早的活跃线并留痕 via=team-default', () => {
    const f = createFixture()
    const { first, second } = createTwoLines(f)

    const message = teamService.sendMailbox({ teamId: f.teamId, type: 'question', content: '无来源提问' })
    const resolved = resolveMailboxLine({ teamId: f.teamId })

    expect(message.conversation_id).toBe(first.conversationId)
    expect(resolved).toMatchObject({ conversationId: first.conversationId, via: 'team-default' })
    expect(first.conversationId).not.toBe(second.conversationId)
  })

  test('④ 默认线取"创建顺序第一条"：同毫秒建线也确定（created_at 相同时 rowid 兜底）', () => {
    const f = createFixture()
    const { first, second } = createTwoLines(f)
    expect(teamConversationStore.listActiveByCreation(f.teamId).map((line) => line.id))
      .toEqual([first.conversationId, second.conversationId])
  })

  test('全链路落空：无活跃线的团队 → 写入拒收 + 不落库（绝不出现无归属的团队级邮件）', () => {
    const f = createFixture()

    expect(() => teamService.sendMailbox({
      teamId: f.teamId, type: 'question', content: '没有线的团队', fromMemberId: f.memberId,
    })).toThrow('没有任何活跃会话线')
    expect(teamMailboxStore.list(f.teamId)).toHaveLength(0)
  })
})

describe('agent 工具视图按线过滤', () => {
  test('team.get / team.mailbox.list / team.task.list：两线各一封邮件各一个任务，各自只见本线', async () => {
    const f = createFixture()
    const { first, second } = createTwoLines(f)
    teamService.sendMailbox({
      teamId: f.teamId, type: 'question', content: '一线的汇报', fromMemberId: f.memberId, sourceSessionId: first.memberSessionId,
    })
    teamService.sendMailbox({
      teamId: f.teamId, type: 'question', content: '二线的汇报', fromMemberId: f.memberId, sourceSessionId: second.memberSessionId,
    })
    teamService.createTask({ teamId: f.teamId, title: '一线的任务', sourceSessionId: first.masterSessionId })
    teamService.createTask({ teamId: f.teamId, title: '二线的任务', sourceSessionId: second.masterSessionId })

    const firstContext: ToolContext = { sessionId: first.memberSessionId, teamId: f.teamId }
    const detail = await executeJson(getTeamHandler, {}, firstContext)
    expect(detail.lineScope).toMatchObject({ conversationId: first.conversationId, via: 'session' })
    expect((detail.mailbox as Array<{ content: string }>).map((row) => row.content)).toEqual(['一线的汇报'])
    expect((detail.tasks as Array<{ title: string }>).map((row) => row.title)).toEqual(['一线的任务'])
    // 名册：本线有格子者（leader + 成员）
    expect((detail.members as unknown[]).length).toBe(2)

    const mailbox = await executeJson(listTeamMailboxHandler, {}, firstContext)
    expect((mailbox.messages as Array<{ content: string }>).map((row) => row.content)).toEqual(['一线的汇报'])
    const tasks = await executeJson(listTeamTasksHandler, {}, firstContext)
    expect((tasks.tasks as Array<{ title: string }>).map((row) => row.title)).toEqual(['一线的任务'])

    const secondContext: ToolContext = { sessionId: second.memberSessionId, teamId: f.teamId }
    const secondDetail = await executeJson(getTeamHandler, {}, secondContext)
    expect(secondDetail.lineScope).toMatchObject({ conversationId: second.conversationId })
    expect((secondDetail.mailbox as Array<{ content: string }>).map((row) => row.content)).toEqual(['二线的汇报'])
    expect((secondDetail.tasks as Array<{ title: string }>).map((row) => row.title)).toEqual(['二线的任务'])
  })

  test('无 taskId 的遗留邮件（迁移前 NULL 行）只在默认线可见，不在他线重复入桶', async () => {
    const f = createFixture()
    const { first, second } = createTwoLines(f)
    const legacy = teamMailboxStore.create({
      teamId: f.teamId, projectId: f.projectId, fromMemberId: f.memberId,
      type: 'report', content: '迁移前的存量汇报',
    })

    const inFirst = await executeJson(listTeamMailboxHandler, {}, { sessionId: first.memberSessionId, teamId: f.teamId })
    const inSecond = await executeJson(listTeamMailboxHandler, {}, { sessionId: second.memberSessionId, teamId: f.teamId })

    expect(legacy.conversation_id).toBeNull()
    expect((inFirst.messages as Array<{ id: string }>).map((row) => row.id)).toEqual([legacy.id])
    expect(inSecond.messages).toEqual([])
  })

  test('无来源会话的历史任务归默认线，不在他线出现', async () => {
    const f = createFixture()
    const { first, second } = createTwoLines(f)
    const legacyTask = teamService.createTask({ teamId: f.teamId, title: '无来源任务' })

    const inFirst = await executeJson(listTeamTasksHandler, {}, { sessionId: first.memberSessionId, teamId: f.teamId })
    const inSecond = await executeJson(listTeamTasksHandler, {}, { sessionId: second.memberSessionId, teamId: f.teamId })

    expect((inFirst.tasks as Array<{ id: string }>).map((row) => row.id)).toEqual([legacyTask.id])
    expect(inSecond.tasks).toEqual([])
  })

  test('team.status 按线过滤：他线成员不进本线成员行，lineScope 回显命中层级', async () => {
    const f = createFixture()
    const { first, second } = createTwoLines(f)
    // 二线独有成员：一线视图看不到他
    const soloAgent = agentStore.create({ name: 'Solo', type: 'dev', runtime: 'mock', projectId: f.projectId })
    const solo = teamMemberStore.create({
      teamId: f.teamId, projectId: f.projectId, agentId: soloAgent.id,
      sessionId: sessionStore.create({ agentId: soloAgent.id, projectId: f.projectId }).id,
      name: 'Solo', role: 'member',
    })
    teamConversationStore.addMember(second.conversationId, solo.id, solo.session_id)

    const status = await executeJson(getTeamStatusHandler, {}, { sessionId: first.memberSessionId, teamId: f.teamId })
    const statusSecond = await executeJson(getTeamStatusHandler, {}, { sessionId: second.memberSessionId, teamId: f.teamId })

    expect(status.lineScope).toMatchObject({ conversationId: first.conversationId })
    expect((status.members as Array<{ memberId: string }>).map((row) => row.memberId)).not.toContain(solo.id)
    expect(statusSecond.lineScope).toMatchObject({ conversationId: second.conversationId })
    expect((statusSecond.members as Array<{ memberId: string }>).map((row) => row.memberId)).toContain(solo.id)
  })

  test('无活跃线：只读工具拒绝并明示原因（不退回"看全团队"）', async () => {
    const f = createFixture()
    const context: ToolContext = { sessionId: f.memberPrimarySessionId, teamId: f.teamId }

    await expect(getTeamHandler.execute({}, context)).rejects.toThrow('没有任何活跃会话线')
    await expect(listTeamMailboxHandler.execute({}, context)).rejects.toThrow('没有任何活跃会话线')
    await expect(listTeamTasksHandler.execute({}, context)).rejects.toThrow('没有任何活跃会话线')
    await expect(getTeamStatusHandler.execute({}, context)).rejects.toThrow('没有任何活跃会话线')
  })

  test('会话不在任何线内（primary 未进线）时按成员主格线/默认线兜底，lineScope 回显命中层级', async () => {
    vi.useFakeTimers()
    const f = createFixture()
    // leader primary 已有历史 → 建线时不复用 primary（线上形态：线 master 是新会话），primary 落在所有线之外。
    getDb().prepare('UPDATE sessions SET last_message_at = ? WHERE id = ?')
      .run(new Date().toISOString(), f.leaderSessionId)
    const first = createLine(f, '一线')
    vi.advanceTimersByTime(1_000)
    const second = createLine(f, '二线')

    const detail = await executeJson(getTeamHandler, {}, { teamId: f.teamId, sessionId: f.leaderSessionId })

    // 会话线解析链：会话不在线内 → 成员主格（primary 也不在线内）→ 团队默认线（最早那条）
    expect(detail.lineScope).toMatchObject({ conversationId: first.conversationId, via: 'team-default' })
    expect(detail.lineScope).not.toMatchObject({ conversationId: second.conversationId })
    expect((detail.members as unknown[]).length).toBe(2)
  })
})

describe('唤醒：同窗拼接（消灭"被 2s 任务唤醒吞掉"）', () => {
  test('3 封任务邮件 + 任务完成同窗：一封唤醒含全部内容（本案回归）', async () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const f = createFixture()
    const { first } = createTwoLines(f)
    const task = teamService.createTask({
      teamId: f.teamId, title: '被吞的活', assigneeMemberId: f.memberId, sourceSessionId: first.masterSessionId,
    })

    for (const content of ['第一封：初版完成', '第二封：补了用例', '第三封：回归通过']) {
      teamService.sendMailbox({
        teamId: f.teamId, type: 'report', content, fromMemberId: f.memberId, taskId: task.id,
      })
    }
    vi.advanceTimersByTime(2_000)
    teamService.updateTask({ teamId: f.teamId, taskId: task.id, status: 'completed', actor: { teamMemberId: f.memberId } })
    vi.advanceTimersByTime(2_100)

    expect(enqueue).toHaveBeenCalledTimes(1)
    const prompt = String(enqueue.mock.calls[0][1])
    for (const content of ['第一封：初版完成', '第二封：补了用例', '第三封：回归通过']) {
      expect(prompt).toContain(content)
    }
    expect(prompt).toContain('Status: completed')
  })

  test('唤醒话术末尾附触发内容快照（任务状态 + 相关邮件摘要），原话术不变', async () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const f = createFixture()
    const { first } = createTwoLines(f)
    const task = teamService.createTask({
      teamId: f.teamId, title: '快照任务', assigneeMemberId: f.memberId, sourceSessionId: first.masterSessionId,
    })
    teamService.sendMailbox({
      teamId: f.teamId, type: 'report', content: '快照里的汇报正文', fromMemberId: f.memberId, taskId: task.id,
    })
    vi.advanceTimersByTime(15_100)

    const prompt = String(enqueue.mock.calls[0][1])
    expect(prompt).toContain('请先使用 team.get 查看最新 Team 状态')
    expect(prompt).toContain('触发内容快照（系统自动附加）：')
    expect(prompt).toContain(`任务：快照任务 (${task.id}) · 状态 draft`)
    expect(prompt).toMatch(new RegExp(`- tmail-\\w+ report · 来自 ${f.memberName} · `))
    expect(prompt).toContain('快照里的汇报正文')
    // 快照在整条 prompt 的末尾
    expect(prompt.trimEnd().endsWith('快照里的汇报正文')).toBe(true)
  })

  test('唤醒落线：二线的邮件只唤醒二线 Master，不惊动一线', async () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const f = createFixture()
    const { first, second } = createTwoLines(f)

    teamService.sendMailbox({
      teamId: f.teamId, type: 'question', content: '二线的问题', fromMemberId: f.memberId, sourceSessionId: second.memberSessionId,
    })
    vi.advanceTimersByTime(2_100)

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue.mock.calls[0][0]).toBe(second.masterSessionId)
    expect(enqueue.mock.calls[0][0]).not.toBe(first.masterSessionId)
  })

  test('同线已投递标记：已唤醒过的邮件不再被重启对账二次唤醒（防翻旧账）', async () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const f = createFixture()
    createTwoLines(f)
    const message = teamService.sendMailbox({
      teamId: f.teamId, type: 'question', content: '只该被唤醒一次', fromMemberId: f.memberId,
    })
    vi.advanceTimersByTime(2_100)
    expect(enqueue).toHaveBeenCalledTimes(1)

    expect(teamWakeCoordinator.recoverPendingWake(message)).toBe(false)
    vi.advanceTimersByTime(2_100)
    expect(enqueue).toHaveBeenCalledTimes(1)
  })
})

describe('加固：汇报必须绑任务 / getBySession 确定化', () => {
  test('team.mailbox.send：type=report/result 未绑任务 → 工具结果明示拒收原因', async () => {
    const f = createFixture()
    createTwoLines(f)
    const context: ToolContext = { sessionId: f.memberPrimarySessionId, teamId: f.teamId }

    await expect(sendTeamMailboxHandler.execute({ type: 'report', content: '未绑任务的汇报' }, context))
      .rejects.toThrow('未绑任务的汇报不会投递')
    await expect(sendTeamMailboxHandler.execute({ type: 'result', content: '未绑任务的结果' }, context))
      .rejects.toThrow('必须带 taskId')
    // 无 taskId 但非汇报类型：照常投递（question 走唤醒白名单）
    const question = await executeJson(sendTeamMailboxHandler, { type: 'question', content: '这个怎么办' }, context)
    expect((question.message as { conversation_id: string }).conversation_id).toBeTruthy()
    // 带 taskId 的 report：投递
    const task = teamService.createTask({ teamId: f.teamId, title: '绑任务的汇报' })
    const report = await executeJson(sendTeamMailboxHandler, { type: 'report', content: '绑定的汇报', taskId: task.id }, context)
    expect((report.message as { task_id: string }).task_id).toBe(task.id)
  })

  test('getBySession 确定化：同一 session 命中多条线时取最近更新的一条', () => {
    vi.useFakeTimers()
    const f = createFixture()
    const first = createLine(f, '一线')
    vi.advanceTimersByTime(1_000)
    const second = createLine(f, '二线')
    // 同一 session 挂进两条线（历史数据/极端时序的形态）：无 ORDER BY 时结果随查询计划漂移。
    teamConversationStore.addMember(second.conversationId, f.memberId, f.memberPrimarySessionId)

    // 二线后创建、updated_at 更新 → 命中二线
    expect(teamConversationStore.getBySession(f.memberPrimarySessionId)?.id).toBe(second.conversationId)
    vi.advanceTimersByTime(1_000)
    teamConversationStore.updateTitle(first.conversationId, '一线改名（updated_at 最新）')
    // 一线刚被更新 → 命中一线（结果随"最近活动"翻转，可复现）
    expect(teamConversationStore.getBySession(f.memberPrimarySessionId)?.id).toBe(first.conversationId)
  })
})

async function executeJson(handler: { execute: (input: Record<string, unknown>, context: ToolContext) => Promise<unknown> }, input: Record<string, unknown>, context: ToolContext): Promise<Record<string, unknown>> {
  const result = await handler.execute(input, context) as { content: Array<{ text?: string }> }
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}

interface LineHandle {
  conversationId: string
  masterSessionId: string
  memberSessionId: string
}

function createFixture() {
  const project = projectStore.create({ name: 'P', workDir: tmp })
  const leaderAgent = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
  const workerAgent = agentStore.create({ name: 'Worker', type: 'dev', runtime: 'mock', projectId: project.id })
  const leaderSession = sessionStore.create({ agentId: leaderAgent.id, projectId: project.id })
  const created = teamService.create({
    projectId: project.id, leaderAgentId: leaderAgent.id, leaderSessionId: leaderSession.id, name: 'Alpha',
  })
  const spawn = teamService.spawnMember({ teamId: created.team.id, agentId: workerAgent.id, name: 'Worker' })
  return {
    projectId: project.id,
    teamId: created.team.id,
    leaderMemberId: created.member.id,
    leaderSessionId: created.session.id,
    memberId: spawn.member.id,
    memberName: spawn.member.name,
    memberPrimarySessionId: spawn.member.session_id,
  }
}

/** 开一条线，返回 master（Leader 格子）与成员格子 session。 */
function createLine(fixture: ReturnType<typeof createFixture>, title: string): LineHandle {
  const created = teamService.createConversation(fixture.teamId, title)
  const grids = teamConversationStore.listMembers(created.conversation.id)
  return {
    conversationId: created.conversation.id,
    masterSessionId: created.conversation.master_session_id,
    memberSessionId: grids.find((row) => row.member_id === fixture.memberId)!.session_id as string,
  }
}

/** 开两条线：一线（默认线，最早）与二线。 */
function createTwoLines(fixture: ReturnType<typeof createFixture>): { first: LineHandle; second: LineHandle } {
  return { first: createLine(fixture, '一线'), second: createLine(fixture, '二线') }
}
