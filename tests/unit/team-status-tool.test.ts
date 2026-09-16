/**
 * team.status（P0a）字段级契约单测：9 条，逐条对应方案文档 §2.5 的用例清单。
 * 覆盖：全员空闲聚合 / 单成员运行态 / 排队深度 / 在飞 / 汇报口径 / 任务统计 / 跨线格子 / 鉴权 / teamId 缺省。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { taskStore } from '../../src/store/tasks.js'
import { teamMailboxStore, teamMemberStore } from '../../src/store/teams.js'
import { teamConversationStore } from '../../src/store/team-conversations.js'
import { createTeamConversation } from '../../src/core/team-conversations.js'
import { sessionManager } from '../../src/core/sessions.js'
import { dispatchMemberPrompt } from '../../src/core/team-member-dispatcher.js'
import { teamService } from '../../src/core/teams.js'
import { getTeamStatusHandler } from '../../src/tools/handlers/team/team-status-tool.js'
import { TEAM_BUILTIN_TOOLS } from '../../src/tools/team-seed.js'
import type { ToolContext } from '../../src/tools/types.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-status-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

interface MemberStatus {
  memberId: string
  name: string
  role: string
  agentId: string
  runtimeState: 'running' | 'idle'
  cells: Array<{ conversationId: string; conversationTitle: string | null; sessionId: string; state: string; stage: string | null }>
  hasPendingMemberPrompt: number
  isMemberPromptInFlight: boolean
  lastReport: { type: string; at: string; sinceLastReportMs: number; taskId: string | null } | null
  taskTotal: number
  taskRunning: number
  taskNeedsInput: number
  taskLastUpdateAt: string | null
  taskTitles: string[]
}

interface TeamStatusPayload {
  teamId: string
  teamName: string
  memberCount: number
  runningMembers: number
  allIdle: boolean
  generatedAt: string
  members: MemberStatus[]
}

function fixtureContext(fixture: ReturnType<typeof createTeamFixture>): ToolContext {
  return { sessionId: fixture.memberSessionId, teamId: fixture.teamId }
}

async function callStatus(context: ToolContext, input: Record<string, unknown> = {}): Promise<TeamStatusPayload> {
  const result = await getTeamStatusHandler.execute(input, context)
  return JSON.parse(result.content[0].text as string) as TeamStatusPayload
}

describe('team.status', () => {
  test('全员空闲无任务：allIdle=true、runningMembers=0，成员带格子与空汇报态', async () => {
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createTeamFixture()
    const payload = await callStatus(fixtureContext(fixture))

    expect(payload.teamId).toBe(fixture.teamId)
    expect(payload.teamName).toBe('Alpha')
    expect(payload.memberCount).toBe(2)
    expect(payload.runningMembers).toBe(0)
    expect(payload.allIdle).toBe(true)
    expect(Date.parse(payload.generatedAt)).not.toBeNaN()

    const member = payload.members.find((item) => item.memberId === fixture.memberId)
    expect(member).toMatchObject({
      role: 'member',
      runtimeState: 'idle',
      hasPendingMemberPrompt: 0,
      isMemberPromptInFlight: false,
      lastReport: null,
      taskTotal: 0,
      taskRunning: 0,
      taskNeedsInput: 0,
      taskLastUpdateAt: null,
      taskTitles: [],
    })
    expect(member!.cells).toEqual([{
      conversationId: fixture.conversationId,
      conversationTitle: '首线',
      sessionId: fixture.memberSessionId,
      state: 'idle',
      stage: null,
    }])
    // leader 排最前
    expect(payload.members[0].role).toBe('leader')
  })

  test('成员格子 promptActive → runtimeState=running、isMemberPromptInFlight 透传、allIdle=false', async () => {
    const fixture = createTeamFixture()
    const runningSessionIds = new Set<string>()
    vi.spyOn(sessionManager, 'isPromptActive').mockImplementation((sessionId: string) => runningSessionIds.has(sessionId))
    // prompt 发出后不结算 → 回合在飞（activeMemberSessions 保留）。
    vi.spyOn(sessionManager, 'enqueuePrompt').mockImplementation(() => new Promise(() => undefined))
    const status = dispatchMemberPrompt({
      teamId: fixture.teamId,
      memberId: fixture.memberId,
      sessionId: fixture.memberSessionId,
      prompt: '干活',
    })
    expect(status).toBe('accepted')
    runningSessionIds.add(fixture.memberSessionId)

    const payload = await callStatus(fixtureContext(fixture))
    const member = payload.members.find((item) => item.memberId === fixture.memberId)!

    expect(member.runtimeState).toBe('running')
    expect(member.cells[0].state).toBe('running')
    expect(member.isMemberPromptInFlight).toBe(true)
    expect(payload.runningMembers).toBe(1)
    expect(payload.allIdle).toBe(false)
  })

  test('忙态下连续派发 → hasPendingMemberPrompt 反映排队深度', async () => {
    const fixture = createTeamFixture()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(true)
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()

    for (const content of ['第一条', '第二条']) {
      const status = dispatchMemberPrompt({
        teamId: fixture.teamId,
        memberId: fixture.memberId,
        sessionId: fixture.memberSessionId,
        prompt: content,
      })
      expect(status).toBe('queued')
    }
    expect(enqueue).not.toHaveBeenCalled()

    const payload = await callStatus(fixtureContext(fixture))
    expect(payload.members.find((item) => item.memberId === fixture.memberId)!.hasPendingMemberPrompt).toBe(2)
  })

  test('最后一条 mailbox 是普通 message（无 taskId）→ lastReport=null（口径=唤醒白名单）', async () => {
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createTeamFixture()
    teamMailboxStore.create({
      teamId: fixture.teamId, projectId: fixture.projectId,
      fromMemberId: fixture.memberId, type: 'message', content: '随便聊聊',
    })

    const payload = await callStatus(fixtureContext(fixture))
    expect(payload.members.find((item) => item.memberId === fixture.memberId)!.lastReport).toBeNull()
  })

  test('最后一条是 report → lastReport 带类型/时间/距上次汇报时长', async () => {
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createTeamFixture()
    teamMailboxStore.create({
      teamId: fixture.teamId, projectId: fixture.projectId,
      fromMemberId: fixture.memberId, type: 'report', content: '阶段汇报', taskId: null,
    })

    const payload = await callStatus(fixtureContext(fixture))
    const lastReport = payload.members.find((item) => item.memberId === fixture.memberId)!.lastReport!
    expect(lastReport.type).toBe('report')
    expect(Date.parse(lastReport.at)).not.toBeNaN()
    expect(lastReport.sinceLastReportMs).toBeGreaterThanOrEqual(0)
    expect(lastReport.taskId).toBeNull()
  })

  test('任务统计：2 个任务 1 running 1 completed，taskLastUpdateAt 取事件表最后更新时间', async () => {
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createTeamFixture()
    const runningTask = teamService.createTask({ teamId: fixture.teamId, title: '修复空指针', assigneeMemberId: fixture.memberId })
    teamService.updateTask({ teamId: fixture.teamId, taskId: runningTask.id, status: 'running' })
    const doneTask = teamService.createTask({ teamId: fixture.teamId, title: '写文档', assigneeMemberId: fixture.memberId })
    teamService.updateTask({ teamId: fixture.teamId, taskId: doneTask.id, status: '已完成' })

    const payload = await callStatus(fixtureContext(fixture))
    const member = payload.members.find((item) => item.memberId === fixture.memberId)!

    expect(member.taskTotal).toBe(2)
    expect(member.taskRunning).toBe(1)
    expect(member.taskNeedsInput).toBe(0)
    expect(member.taskTitles).toEqual(['修复空指针'])
    expect(Date.parse(member.taskLastUpdateAt!)).not.toBeNaN()
    expect(member.taskLastUpdateAt! >= taskStore.get(doneTask.id)!.created_at).toBe(true)
  })

  test('成员跨两条线各有格子：cells 长度 2，任一 running → 成员 running', async () => {
    const fixture = createTeamFixture()
    const second = createTeamConversation(fixture.teamId, '二线')
    const grids = teamConversationStore.listMembers(second.conversation.id)
      .filter((row) => row.member_id === fixture.memberId)
      .map((row) => row.session_id)
    const otherSessionId = grids[0]!
    vi.spyOn(sessionManager, 'isPromptActive').mockImplementation((sessionId: string) => sessionId === otherSessionId)

    const payload = await callStatus(fixtureContext(fixture))
    const member = payload.members.find((item) => item.memberId === fixture.memberId)!

    expect(member.cells).toHaveLength(2)
    expect(member.cells.map((cell) => cell.conversationTitle).sort()).toEqual(['二线', '首线'])
    expect(member.cells.find((cell) => cell.sessionId === otherSessionId)!.state).toBe('running')
    expect(member.runtimeState).toBe('running')
  })

  test('排队/在飞按"primary + 全部格子"聚合：第二条线的格子有排队也不漏（F1 回放）', async () => {
    const fixture = createTeamFixture()
    const second = createTeamConversation(fixture.teamId, '二线')
    // 二线的格子 = 该成员在第二条线上的派发目标（与 primary 不同的 session）。
    const secondCellSessionId = teamConversationStore.listMembers(second.conversation.id)
      .find((row) => row.member_id === fixture.memberId)!.session_id as string
    expect(secondCellSessionId).not.toBe(fixture.memberSessionId)

    // 成员在二线忙：派发只能排队（在飞/深度都发生在二线格子，不在 primary）。
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(true)
    vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    for (const content of ['二线第一条', '二线第二条']) {
      expect(dispatchMemberPrompt({
        teamId: fixture.teamId, memberId: fixture.memberId, sessionId: secondCellSessionId, prompt: content,
      })).toBe('queued')
    }

    const payload = await callStatus(fixtureContext(fixture))
    const member = payload.members.find((item) => item.memberId === fixture.memberId)!
    expect(member.hasPendingMemberPrompt).toBe(2)
  })

  test('在飞聚合：回合跑在非 primary 格子上也能看到', async () => {
    const fixture = createTeamFixture()
    const second = createTeamConversation(fixture.teamId, '二线')
    const secondCellSessionId = teamConversationStore.listMembers(second.conversation.id)
      .find((row) => row.member_id === fixture.memberId)!.session_id as string

    const runningSessionIds = new Set<string>()
    vi.spyOn(sessionManager, 'isPromptActive').mockImplementation((sessionId: string) => runningSessionIds.has(sessionId))
    vi.spyOn(sessionManager, 'enqueuePrompt').mockImplementation(() => new Promise(() => undefined))
    expect(dispatchMemberPrompt({
      teamId: fixture.teamId, memberId: fixture.memberId, sessionId: secondCellSessionId, prompt: '二线干活',
    })).toBe('accepted')
    runningSessionIds.add(secondCellSessionId)

    const payload = await callStatus(fixtureContext(fixture))
    const member = payload.members.find((item) => item.memberId === fixture.memberId)!
    expect(member.isMemberPromptInFlight).toBe(true)
    expect(member.runtimeState).toBe('running')
  })

  test('排序：同为非 leader（异角色）时按名字升序（F4）', async () => {
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createTeamFixture()
    // 伪造一条异角色成员（role 不在 leader/member 二值内），确保兜底分支走 name 比较。
    const alpha = teamMemberStore.create({
      teamId: fixture.teamId, projectId: fixture.projectId, agentId: 'agent-zzz',
      sessionId: 'sess-zzz', name: 'Zeta', role: 'observer',
    })
    const beta = teamMemberStore.create({
      teamId: fixture.teamId, projectId: fixture.projectId, agentId: 'agent-aaa',
      sessionId: 'sess-aaa', name: 'Alpha', role: 'observer',
    })

    const payload = await callStatus(fixtureContext(fixture))
    const observerNames = payload.members.filter((item) => item.role === 'observer').map((item) => item.name)
    expect(observerNames).toEqual(['Alpha', 'Zeta'])
    expect(payload.members.some((item) => item.memberId === alpha.id)).toBe(true)
    expect(payload.members.some((item) => item.memberId === beta.id)).toBe(true)
  })

  test('工具描述单一来源：seed 与 handler 文案一致（F7 防漂移）', () => {
    const seeded = TEAM_BUILTIN_TOOLS.find((tool) => tool.name === 'team.status')
    expect(seeded?.description).toBe(getTeamStatusHandler.description)
  })

  test('鉴权：非本团队成员拒绝，成员角色可调通', async () => {
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createTeamFixture()
    const other = createTeamFixture('Beta')

    await expect(callStatus({ sessionId: other.memberSessionId }, { teamId: fixture.teamId }))
      .rejects.toThrow('仅本 Team 成员可访问内部信息或操作')

    const payload = await callStatus(fixtureContext(fixture))
    expect(payload.teamId).toBe(fixture.teamId)
  })

  test('teamId 缺省走 context.teamId；两者皆空报 teamId 不能为空', async () => {
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
    const fixture = createTeamFixture()

    const viaContext = await callStatus({ sessionId: fixture.memberSessionId, teamId: fixture.teamId })
    expect(viaContext.teamId).toBe(fixture.teamId)

    await expect(callStatus({ sessionId: fixture.memberSessionId })).rejects.toThrow('teamId 不能为空')
  })
})

function createTeamFixture(name = 'Alpha') {
  const project = projectStore.create({ name: `P-${name}`, workDir: tmp })
  const leaderAgent = agentStore.create({ name: `Leader-${name}`, type: 'architect', runtime: 'mock', projectId: project.id })
  const created = teamService.create({ projectId: project.id, leaderAgentId: leaderAgent.id, name })
  const workerAgent = agentStore.create({ name: `Worker-${name}`, type: 'dev', runtime: 'mock', projectId: project.id })
  const spawn = teamService.spawnMember({ teamId: created.team.id, agentId: workerAgent.id, name: `Worker-${name}` })
  const conversation = createTeamConversation(created.team.id, '首线')
  const memberSessionId = teamConversationStore.listMembers(conversation.conversation.id)
    .find((row) => row.member_id === spawn.member.id)!.session_id as string

  return {
    projectId: project.id,
    teamId: created.team.id,
    leaderMemberId: teamMemberStore.list(created.team.id).find((member) => member.role === 'leader')!.id,
    leaderSessionId: created.session.id,
    memberId: spawn.member.id,
    memberSessionId,
    conversationId: conversation.conversation.id,
  }
}
