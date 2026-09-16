/**
 * 静默回合兜底唤醒（P0b）单测：12 条，逐条对应方案文档 §2.5 用例清单。
 * 三个硬约束的回归守卫：
 *  ① 挂载 committed_done（不是 session:done）—— 用例 21 正反两面断言；
 *  ② 合并桶追加语义（同窗口多成员不丢报）—— 用例 20；
 *  ③ 时间窗起点 = 回合 human 消息时间戳 —— 用例 11/12（回合内的汇报/任务更新必须被识别）。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import { teamMemberStore } from '../../src/store/teams.js'
import { teamConversationStore } from '../../src/store/team-conversations.js'
import { turnProcessItemStore } from '../../src/store/turn-process-items.js'
import { createTeamConversation } from '../../src/core/team-conversations.js'
import { events } from '../../src/core/events.js'
import { sessionManager } from '../../src/core/sessions.js'
import { teamService } from '../../src/core/teams.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-silent-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

/** 触发一次"派发回合结束"：human（署名可配）→ agent 回复 → committed_done。 */
function runDispatchedTurn(input: {
  sessionId: string
  agentId: string
  reply?: string
  senderRole?: string
  stopReason?: string
  error?: string
}): void {
  // 时钟前移：让"回合开始"严格晚于建团/建任务（假时钟下同一毫秒会让建任务事件落进本回合窗口）。
  vi.advanceTimersByTime(10)
  messageStore.append(input.sessionId, {
    role: 'human',
    content: '派活内容',
    senderRole: input.senderRole ?? 'team-assignment',
    senderName: 'Master',
  })
  const replyMessage = input.reply === undefined
    ? undefined
    : messageStore.append(input.sessionId, { role: 'agent', content: input.reply, status: 'completed' })
  events.emit('session:committed_done', {
    sessionId: input.sessionId,
    agentId: input.agentId,
    messageId: replyMessage?.id ?? `done-${Math.random()}`,
    stopReason: input.stopReason ?? 'end_turn',
    ...(input.error ? { error: input.error } : {}),
  })
}

function wakePrompts(enqueue: { mock: { calls: unknown[][] } }): string[] {
  return enqueue.mock.calls.map((call) => String(call[1]))
}

describe('team silent-turn fallback wake', () => {
  test('派发回合结束未汇报 → 兜底唤醒一次，prompt 带最后回复原文与距派发时长', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createFixture()

    runDispatchedTurn({
      sessionId: fixture.memberSessionId,
      agentId: fixture.memberAgentId,
      reply: '已定位到解析层的空指针：parseTsvNode 在 children 为空时直接取 [0]。',
    })
    vi.advanceTimersByTime(15_100)

    expect(enqueue).toHaveBeenCalledTimes(1)
    const [targetSessionId, prompt] = enqueue.mock.calls[0]
    expect(targetSessionId).toBe(fixture.leaderSessionId)
    const text = String(prompt)
    expect(text).toContain('没有给你发过汇报')
    expect(text).toContain('已定位到解析层的空指针')
    expect(text).toContain('距派发:')
    expect(text).toContain('Worker')
    expect(text).toContain('首线')
  })

  test('回合内发过 report → 兜底不触发（只剩 mailbox 自身的既有唤醒）', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createFixture()

    vi.advanceTimersByTime(10)
    messageStore.append(fixture.memberSessionId, { role: 'human', content: '派活内容', senderRole: 'team-assignment' })
    teamService.sendMailbox({
      teamId: fixture.teamId, type: 'report', content: '阶段汇报已发', fromMemberId: fixture.memberId,
    })
    messageStore.append(fixture.memberSessionId, { role: 'agent', content: '已汇报', status: 'completed' })
    events.emit('session:committed_done', {
      sessionId: fixture.memberSessionId, agentId: fixture.memberAgentId, messageId: 'done-1', stopReason: 'end_turn',
    })
    vi.advanceTimersByTime(15_100)

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(String(enqueue.mock.calls[0][1])).toContain('新的异步进展')
    expect(wakePrompts(enqueue).some((text) => text.includes('没有给你发过汇报'))).toBe(false)
  })

  test('回合内只更新了任务状态 → 兜底不触发，既有任务唤醒照常', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createFixture()

    vi.advanceTimersByTime(10)
    messageStore.append(fixture.memberSessionId, { role: 'human', content: '派活内容', senderRole: 'team-assignment' })
    teamService.updateTask({
      teamId: fixture.teamId, taskId: fixture.taskId, status: 'needs_input', stage: '等用户确认',
      actor: { teamMemberId: fixture.memberId },
    })
    messageStore.append(fixture.memberSessionId, { role: 'agent', content: '卡在权限问题', status: 'completed' })
    events.emit('session:committed_done', {
      sessionId: fixture.memberSessionId, agentId: fixture.memberAgentId, messageId: 'done-2', stopReason: 'end_turn',
    })
    vi.advanceTimersByTime(15_100)

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(String(enqueue.mock.calls[0][1])).toContain('Status: needs_input')
    expect(wakePrompts(enqueue).some((text) => text.includes('没有给你发过汇报'))).toBe(false)
  })

  test('系统署名回合（team-system）→ 不触发（来源锁）', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createFixture()

    runDispatchedTurn({
      sessionId: fixture.memberSessionId, agentId: fixture.memberAgentId,
      reply: '收到', senderRole: 'team-system',
    })
    vi.advanceTimersByTime(20_000)

    expect(enqueue).not.toHaveBeenCalled()
  })

  test('leader 自己的回合 → 不触发', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createFixture()

    runDispatchedTurn({
      sessionId: fixture.leaderSessionId, agentId: fixture.leaderAgentId,
      reply: '我来安排',
    })
    vi.advanceTimersByTime(20_000)

    expect(enqueue).not.toHaveBeenCalled()
  })

  test('会话不属于任何团队线 → 不触发', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createFixture()
    const orphan = sessionStore.create({ agentId: fixture.memberAgentId, projectId: fixture.projectId })

    runDispatchedTurn({ sessionId: orphan.id, agentId: fixture.memberAgentId, reply: '孤儿会话回合' })
    vi.advanceTimersByTime(20_000)

    expect(enqueue).not.toHaveBeenCalled()
  })

  test('stopReason=error → prompt 带错误原文 + 最后回复', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createFixture()

    runDispatchedTurn({
      sessionId: fixture.memberSessionId, agentId: fixture.memberAgentId,
      reply: '正在跑测试……', stopReason: 'error', error: 'Agent 进程意外退出 (code=1)',
    })
    vi.advanceTimersByTime(15_100)

    expect(enqueue).toHaveBeenCalledTimes(1)
    const text = String(enqueue.mock.calls[0][1])
    expect(text).toContain('以错误终止')
    expect(text).toContain('Agent 进程意外退出 (code=1)')
    expect(text).toContain('正在跑测试……')
  })

  test('stopReason=cancelled → 中断事实 + 停止时说到哪；无文本时回退最后动作', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createFixture()

    runDispatchedTurn({
      sessionId: fixture.memberSessionId, agentId: fixture.memberAgentId,
      reply: '刚改到一半', stopReason: 'cancelled',
    })
    vi.advanceTimersByTime(15_100)
    const cancelledPrompt = wakePrompts(enqueue).find((text) => text.includes('被中断'))
    expect(cancelledPrompt).toContain('刚改到一半')

    // 纯工具回合（无文本）：回退到最后一个 process item 标题。换新成员避开频次/抑制状态。
    const second = createFixture('Beta')
    vi.advanceTimersByTime(10)
    messageStore.append(second.memberSessionId, { role: 'human', content: '派活内容', senderRole: 'team-assignment' })
    turnProcessItemStore.upsert({
      sessionId: second.memberSessionId, messageId: 'msg-tool-only', kind: 'tool', title: '运行 tsc 失败',
    })
    events.emit('session:committed_done', {
      sessionId: second.memberSessionId, agentId: second.memberAgentId, messageId: 'msg-tool-only', stopReason: 'cancelled',
    })
    vi.advanceTimersByTime(15_100)

    const fallback = wakePrompts(enqueue).find((text) => text.includes('无文本输出'))
    expect(fallback).toBeDefined()
    expect(fallback).toContain('最后动作：运行 tsc 失败')
  })

  test('同成员连续两次静默回合（期间无新进展）→ 只提醒一次（无新进展抑制）', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createFixture()

    runDispatchedTurn({ sessionId: fixture.memberSessionId, agentId: fixture.memberAgentId, reply: '第一次没汇报' })
    vi.advanceTimersByTime(15_100)
    runDispatchedTurn({ sessionId: fixture.memberSessionId, agentId: fixture.memberAgentId, reply: '第二次还没汇报' })
    vi.advanceTimersByTime(15_100)

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(String(enqueue.mock.calls[0][1])).toContain('第一次没汇报')
  })

  test('每成员每小时第 7 次静默 → 被频次帽丢弃（默认上限 6）', async () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createFixture()

    for (let round = 1; round <= 7; round += 1) {
      // 轮间进展（非唤醒级任务更新）：解除"无新进展抑制"，但落在下一回合时间窗之外。
      teamService.updateTask({
        teamId: fixture.teamId, taskId: fixture.taskId, status: 'running', stage: `第 ${round} 轮`,
      })
      runDispatchedTurn({ sessionId: fixture.memberSessionId, agentId: fixture.memberAgentId, reply: `第 ${round} 轮没汇报` })
      // Async 版本会结算 sendWake 的 finally（activeLeaderSessions 释放），否则后续 flush 一直被忙锁挡住。
      await vi.advanceTimersByTimeAsync(15_100)
    }

    expect(enqueue).toHaveBeenCalledTimes(6)
  })

  test('两成员在合并窗口内先后静默 → 合并成一封唤醒（追加语义，不丢报）', async () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createFixture()
    const secondWorkerAgent = agentStore.create({ name: 'Worker2', type: 'dev', runtime: 'mock', projectId: fixture.projectId })
    const second = teamService.spawnMember({ teamId: fixture.teamId, agentId: secondWorkerAgent.id, name: 'Worker2' })
    teamService.createTask({ teamId: fixture.teamId, title: '第二个任务', assigneeMemberId: second.member.id })
    const secondSessionId = teamConversationStore.listMembers(fixture.conversationId)
      .find((row) => row.member_id === second.member.id)!.session_id as string

    runDispatchedTurn({ sessionId: fixture.memberSessionId, agentId: fixture.memberAgentId, reply: '甲没汇报' })
    runDispatchedTurn({ sessionId: secondSessionId, agentId: teamMemberStore.get(second.member.id)!.agent_id, reply: '乙没汇报' })
    await vi.advanceTimersByTimeAsync(15_100)

    expect(enqueue).toHaveBeenCalledTimes(1)
    const text = String(enqueue.mock.calls[0][1])
    expect(text).toContain('Worker')
    expect(text).toContain('Worker2')
    expect(text).toContain('甲没汇报')
    expect(text).toContain('乙没汇报')
  })

  test('回归守卫：session:done 不触发；committed_done 读到的是最终文本', () => {
    vi.useFakeTimers()
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createFixture()

    vi.advanceTimersByTime(10)
    messageStore.append(fixture.memberSessionId, { role: 'human', content: '派活内容', senderRole: 'team-assignment' })
    // 回合进行中的快照（running），session:done 时刻只存在这一条
    const running = messageStore.append(fixture.memberSessionId, {
      role: 'agent', content: '半截草稿……', status: 'running',
    })
    events.emit('session:done', {
      sessionId: fixture.memberSessionId, agentId: fixture.memberAgentId, messageId: running.id, stopReason: 'end_turn',
    })
    vi.advanceTimersByTime(20_000)
    expect(enqueue).not.toHaveBeenCalled()

    // 最终文本落库后 committed_done 才触发判定
    const final = messageStore.append(fixture.memberSessionId, { role: 'agent', content: '最终结论：已修复并自测通过', status: 'completed' })
    events.emit('session:committed_done', {
      sessionId: fixture.memberSessionId, agentId: fixture.memberAgentId, messageId: final.id, stopReason: 'end_turn',
    })
    vi.advanceTimersByTime(15_100)

    expect(enqueue).toHaveBeenCalledTimes(1)
    const text = String(enqueue.mock.calls[0][1])
    expect(text).toContain('最终结论：已修复并自测通过')
    expect(text).not.toContain('半截草稿')
  })
})

function createFixture(name = 'Alpha') {
  const project = projectStore.create({ name: `P-${name}`, workDir: tmp })
  const leaderAgent = agentStore.create({ name: `Leader-${name}`, type: 'architect', runtime: 'mock', projectId: project.id })
  const created = teamService.create({ projectId: project.id, leaderAgentId: leaderAgent.id, name })
  const workerAgent = agentStore.create({ name: `Worker-${name}`, type: 'dev', runtime: 'mock', projectId: project.id })
  const spawn = teamService.spawnMember({ teamId: created.team.id, agentId: workerAgent.id, name: `Worker-${name}` })
  const conversation = createTeamConversation(created.team.id, '首线')
  const memberSessionId = teamConversationStore.listMembers(conversation.conversation.id)
    .find((row) => row.member_id === spawn.member.id)!.session_id as string
  const task = teamService.createTask({
    teamId: created.team.id, title: '修复空指针', assigneeMemberId: spawn.member.id,
  })

  return {
    projectId: project.id,
    teamId: created.team.id,
    leaderAgentId: created.member.agent_id,
    leaderSessionId: created.session.id,
    memberId: spawn.member.id,
    memberAgentId: spawn.agent.id,
    memberSessionId,
    conversationId: conversation.conversation.id,
    taskId: task.id,
  }
}
