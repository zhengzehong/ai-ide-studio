/* 团队会话线复制集成测试：Master + 全部成员格子 fork（空转录）、preferences 随迁先于 fork、
 * 冷格子降级、忙线（running / dispatcher 排队）拒绝、fork 失败整线回滚、防连点。
 * 运行时 fork 通过 mock acpHost.forkSessionFromAcpSessionId / closeSession 完成（embedded port 委托 acpHost）。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { acpHost } from '../../src/acp/host.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { eventStore, messageStore, sessionStore } from '../../src/store/sessions.js'
import { projectStore } from '../../src/store/projects.js'
import { teamConversationStore } from '../../src/store/team-conversations.js'
import { sessionManager, COPYING_STAGE } from '../../src/core/sessions.js'
import { cancelPendingForSessions, dispatchMemberPrompt } from '../../src/core/team-member-dispatcher.js'
import { copyTeamConversation } from '../../src/core/team-conversations.js'
import { teamService } from '../../src/core/teams.js'
import { events } from '../../src/core/events.js'

let tempDir: string
/** installForkMock 直接替换 acpHost 方法（模块级单例），每个用例结束必须还原。 */
let restoreHostMocks: (() => void) | null = null

beforeEach(() => {
  tempDir = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-conversation-copy-'))
  initDatabase(resolve(tempDir, 'test.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  restoreHostMocks?.()
  restoreHostMocks = null
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

interface Fixture {
  projectId: string
  teamId: string
  conversationId: string
  leaderMemberId: string
  memberMemberId: string
  /** 首线格子 = 各自 primary（createTeamConversation 复用 primary 语义）。 */
  leaderGridSessionId: string
  memberGridSessionId: string
}

function setupFixture(): Fixture {
  const project = projectStore.create({ name: '复制团队', workDir: tempDir })
  const leaderAgent = agentStore.create({ name: 'Master', type: 'leader', runtime: 'mock', projectId: project.id })
  const memberAgent = agentStore.create({ name: 'Dev-GLM', type: 'developer', runtime: 'mock', projectId: project.id })
  // teamService.create 会对 Leader Agent 做拷贝并新建其 Master 会话；成员 spawnMember 复用/新建 primary。
  const team = teamService.create({ projectId: project.id, leaderAgentId: leaderAgent.id, name: '复制团队' })
  const member = teamService.spawnMember({ teamId: team.team.id, agentId: memberAgent.id })
  const leaderSessionId = team.session.id
  const memberSessionId = member.session.id
  const detail = teamService.createConversation(team.team.id, '首线')
  const grids = teamConversationStore.listMembers(detail.conversation.id)
  const leaderGrid = grids.find((grid) => grid.member_id === team.member.id)
  const memberGrid = grids.find((grid) => grid.member_id === member.member.id)
  if (!leaderGrid?.session_id || !memberGrid?.session_id) throw new Error('fixture grids missing')
  // 首线复用 primary：断言这个形态成立，源线 master 就是 Leader 成员会话。
  expect(leaderGrid.session_id).toBe(leaderSessionId)
  expect(memberGrid.session_id).toBe(memberSessionId)
  expect(detail.conversation.master_session_id).toBe(leaderSessionId)
  return {
    projectId: project.id,
    teamId: team.team.id,
    conversationId: detail.conversation.id,
    leaderMemberId: team.member.id,
    memberMemberId: member.member.id,
    leaderGridSessionId: leaderGrid.session_id,
    memberGridSessionId: memberGrid.session_id,
  }
}

interface ForkCall {
  sourceAcpSessionId: string
  targetSessionId: string
  /** fork 发起那一刻目标会话的 runtime_preferences：断言「先迁 preferences 再 fork」的关键证据。 */
  prefsAtForkTime: { modelId?: string; modeId?: string; config?: Record<string, string | boolean> }
}

interface ForkMockOptions {
  /** 卡住 fork 让后台复制停在半途（防连点用例）。 */
  gate?: Promise<void>
  /** 命中该源 acp id 时抛错（回滚用例）。 */
  failOnSourceAcp?: string
}

function installForkMock(options: ForkMockOptions = {}): { calls: ForkCall[]; closeCalls: string[] } {
  const calls: ForkCall[] = []
  const closeCalls: string[] = []
  const originalFork = acpHost.forkSessionFromAcpSessionId
  const originalClose = acpHost.closeSession
  acpHost.forkSessionFromAcpSessionId = (async (_agentId, sourceAcpSessionId, targetSessionId) => {
    calls.push({ sourceAcpSessionId, targetSessionId, prefsAtForkTime: sessionStore.getRuntimePreferences(targetSessionId) })
    if (options.gate) await options.gate
    if (options.failOnSourceAcp === sourceAcpSessionId) throw new Error('模拟 fork 失败')
    return `acp-${targetSessionId}`
  }) as typeof acpHost.forkSessionFromAcpSessionId
  acpHost.closeSession = (async (_agentId, sessionId) => {
    closeCalls.push(sessionId)
  }) as typeof acpHost.closeSession
  restoreHostMocks = () => {
    acpHost.forkSessionFromAcpSessionId = originalFork
    acpHost.closeSession = originalClose
    restoreHostMocks = null
  }
  return { calls, closeCalls }
}

/** 等后台 completeTeamConversationCopy 推进到位（fork 调用次数 / 目标格子拿到 acp id）。 */
async function waitForCondition(assert: () => void, timeout = 5000): Promise<void> {
  await vi.waitFor(assert, { timeout, interval: 25 })
}

describe('team conversation copy', () => {
  test('复制成功：新线/格子齐全、空转录、preferences 先迁后 fork、原线零变化、深链成立', async () => {
    const fixture = setupFixture()
    sessionStore.updateAcpSessionId(fixture.leaderGridSessionId, 'acp-leader-src')
    sessionStore.updateAcpSessionId(fixture.memberGridSessionId, 'acp-member-src')
    // 成员格子手切过档位（最高优先级保真点）：fork 完成时按目标会话自身 preferences 重放，必须先随迁再 fork。
    sessionStore.updateRuntimePreferences(fixture.memberGridSessionId, { config: { effort: 'high' } })
    messageStore.append(fixture.leaderGridSessionId, { role: 'human', content: '源线 Master 消息' })
    messageStore.append(fixture.memberGridSessionId, { role: 'agent', content: '源线成员消息', senderName: 'Dev-GLM' })
    eventStore.append(fixture.memberGridSessionId, {
      type: 'message.user', agentId: 'agent-x', acpSessionId: 'acp-member-src',
      payload: { content: '源线事件' },
    })
    const mock = installForkMock()

    const copied = copyTeamConversation(fixture.conversationId)

    // 同步返回占位：新线行 + 全部格子行
    expect(copied.team_id).toBe(fixture.teamId)
    expect(copied.status).toBe('active')
    expect(copied.title).toBe('首线（副本）')
    expect(copied.master_session_id).not.toBe(fixture.leaderGridSessionId)
    const copiedMembers = teamConversationStore.listMembers(copied.id)
    expect(copiedMembers).toHaveLength(2)
    const newLeaderGridId = copiedMembers.find((grid) => grid.member_id === fixture.leaderMemberId)!.session_id!
    const newMemberGridId = copiedMembers.find((grid) => grid.member_id === fixture.memberMemberId)!.session_id!
    expect(newLeaderGridId).not.toBe(fixture.leaderGridSessionId)
    expect(newMemberGridId).not.toBe(fixture.memberGridSessionId)
    // 占位态：COPYING_STAGE + 无 acp id
    expect(sessionStore.get(newLeaderGridId)?.stage).toBe(COPYING_STAGE)
    expect(sessionStore.get(newLeaderGridId)?.acp_session_id).toBeNull()

    await waitForCondition(() => {
      expect(mock.calls).toHaveLength(2)
      expect(sessionStore.get(newLeaderGridId)?.acp_session_id).toBe(`acp-${newLeaderGridId}`)
      expect(sessionStore.get(newMemberGridId)?.acp_session_id).toBe(`acp-${newMemberGridId}`)
    })

    // 每格子 fork 恰好一次、源 acp 正确（顺序 = listMembers 行序，非契约，断言用集合）
    expect([...mock.calls.map((call) => call.sourceAcpSessionId)].sort()).toEqual(['acp-leader-src', 'acp-member-src'])
    // ★ 保真点断言：fork 发起时目标会话已带上源格子的手切档位（先复制 preferences 再 fork）
    const memberForkCall = mock.calls.find((call) => call.targetSessionId === newMemberGridId)!
    expect(memberForkCall.prefsAtForkTime.config?.effort).toBe('high')
    // fork 完成后 preferences 持久保留在目标会话上
    expect(sessionStore.getRuntimePreferences(newMemberGridId).config?.effort).toBe('high')
    // 占位 stage 清空
    expect(sessionStore.get(newLeaderGridId)?.stage).toBe('')
    expect(sessionStore.get(newMemberGridId)?.stage).toBe('')

    // 空转录：messages / session_events / turn_process_items 全为 0
    for (const newGridId of [newLeaderGridId, newMemberGridId]) {
      expect(messageStore.list(newGridId, { includeToolCalls: true })).toHaveLength(0)
      expect(eventStore.list(newGridId, { limit: 50 })).toHaveLength(0)
      expect(getDb().prepare('SELECT COUNT(*) AS count FROM turn_process_items WHERE session_id = ?').get(newGridId)).toEqual({ count: 0 })
    }

    // 原线零变化：行、格子映射、消息、运行时 acp id 全部原样（格子集合比较——同毫秒 created_at
    // 并列时 joined 行序非契约，reviewer 复现 8 轮 2 败）
    const source = teamConversationStore.get(fixture.conversationId)
    expect(source?.status).toBe('active')
    expect(source?.title).toBe('首线')
    expect(source?.master_session_id).toBe(fixture.leaderGridSessionId)
    expect(teamConversationStore.listMembers(fixture.conversationId).map((grid) => grid.session_id).sort())
      .toEqual([fixture.leaderGridSessionId, fixture.memberGridSessionId].sort())
    expect(messageStore.list(fixture.leaderGridSessionId)).toHaveLength(1)
    expect(messageStore.list(fixture.memberGridSessionId)).toHaveLength(1)
    expect(eventStore.list(fixture.memberGridSessionId, { limit: 50 })).toHaveLength(1)
    expect(sessionStore.get(fixture.leaderGridSessionId)?.acp_session_id).toBe('acp-leader-src')
    expect(sessionStore.get(fixture.memberGridSessionId)?.acp_session_id).toBe('acp-member-src')

    // 深链：新格子反查到新线，旧格子反查到旧线
    expect(teamConversationStore.getBySession(newLeaderGridId)?.id).toBe(copied.id)
    expect(teamConversationStore.getBySession(fixture.leaderGridSessionId)?.id).toBe(fixture.conversationId)
  })

  test('冷格子降级：无 acp_session_id 的格子跳过 fork，新格子保持空', async () => {
    const fixture = setupFixture()
    sessionStore.updateAcpSessionId(fixture.leaderGridSessionId, 'acp-leader-src')
    // 成员格子从未跑过 prompt：无 acp id（冷格子）
    const mock = installForkMock()

    const copied = copyTeamConversation(fixture.conversationId)
    const copiedMembers = teamConversationStore.listMembers(copied.id)
    const newLeaderGridId = copiedMembers.find((grid) => grid.member_id === fixture.leaderMemberId)!.session_id!
    const newMemberGridId = copiedMembers.find((grid) => grid.member_id === fixture.memberMemberId)!.session_id!

    await waitForCondition(() => {
      expect(sessionStore.get(newLeaderGridId)?.acp_session_id).toBe(`acp-${newLeaderGridId}`)
    })

    // 只有热格子 fork；冷格子不 fork、stage 清空、保持无 acp id
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].targetSessionId).toBe(newLeaderGridId)
    expect(sessionStore.get(newMemberGridId)?.stage).toBe('')
    expect(sessionStore.get(newMemberGridId)?.acp_session_id).toBeNull()
    // 冷格子不回滚：新线仍在
    expect(teamConversationStore.get(copied.id)?.status).toBe('active')
  })

  test('忙线拒绝：格子会话在跑时复制抛错且不产生任何新行', async () => {
    const fixture = setupFixture()
    const conversationsBefore = teamConversationStore.list(fixture.teamId).length
    const spy = vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(true)
    try {
      expect(() => copyTeamConversation(fixture.conversationId))
        .toThrow('团队会话正在运行或有排队消息，空闲后再复制')
      expect(teamConversationStore.list(fixture.teamId)).toHaveLength(conversationsBefore)
      expect(teamConversationStore.listMembers(fixture.conversationId)).toHaveLength(2)
    } finally {
      spy.mockRestore()
    }
  })

  test('排队拒绝：dispatcher 还有未派发排队指令时复制抛错（isPromptActive 已复位）', async () => {
    const fixture = setupFixture()
    const spy = vi.spyOn(sessionManager, 'isPromptActive')
    try {
      // 先让消息排队（isPromptActive=true 时 drain 不启动），再复位运行态——队列仍在内存里
      spy.mockReturnValue(true)
      const status = dispatchMemberPrompt({
        teamId: fixture.teamId, memberId: fixture.memberMemberId,
        sessionId: fixture.memberGridSessionId, prompt: '还没执行的排队指令',
      })
      expect(status).toBe('queued')
      spy.mockReturnValue(false)
      // 运行态已空闲，但排队探针仍应拒绝复制
      expect(() => copyTeamConversation(fixture.conversationId))
        .toThrow('团队会话正在运行或有排队消息，空闲后再复制')
    } finally {
      cancelPendingForSessions([fixture.memberGridSessionId])
      spy.mockRestore()
    }
  })

  test('fork 失败整线回滚：新格子关闭+删除、新线置 deleted、原线不受影响、失败原因广播', async () => {
    const fixture = setupFixture()
    sessionStore.updateAcpSessionId(fixture.leaderGridSessionId, 'acp-leader-src')
    sessionStore.updateAcpSessionId(fixture.memberGridSessionId, 'acp-member-src')
    const mock = installForkMock({ failOnSourceAcp: 'acp-member-src' })
    const teamUpdates: Array<Record<string, unknown>> = []
    const onTeamUpdate = (payload: unknown): void => { teamUpdates.push(payload as Record<string, unknown>) }
    events.on('team:update', onTeamUpdate)
    try {
      const copied = copyTeamConversation(fixture.conversationId)
      const copiedMembers = teamConversationStore.listMembers(copied.id)
      const newGridIds = copiedMembers.map((grid) => grid.session_id!)

      // all-or-nothing：任一格子失败 → 整线回滚
      await waitForCondition(() => {
        expect(teamConversationStore.get(copied.id)?.status).toBe('deleted')
      })
      // 新格子：runtime closeSession + DB 软删除（sessionStore.get 不过滤 deleted_at，断言 deleted_at 非空）
      expect(mock.closeCalls.sort()).toEqual([...newGridIds].sort())
      for (const gridId of newGridIds) {
        expect(sessionStore.get(gridId)?.deleted_at).toBeTruthy()
      }
      // 原线原样
      expect(teamConversationStore.get(fixture.conversationId)?.status).toBe('active')
      // 失败原因经 team:update 通道广播（UI 错误条消费 reason='conversation.copy_failed'）
      const failure = teamUpdates.find((payload) => (payload.data as { reason?: string } | undefined)?.reason === 'conversation.copy_failed')
      expect(failure).toBeTruthy()
      expect((failure!.data as { message?: string }).message).toBe('模拟 fork 失败')
    } finally {
      events.off('team:update', onTeamUpdate)
    }
  })

  test('防连点：复制进行中再次复制同一条线抛错', async () => {
    const fixture = setupFixture()
    sessionStore.updateAcpSessionId(fixture.leaderGridSessionId, 'acp-leader-src')
    sessionStore.updateAcpSessionId(fixture.memberGridSessionId, 'acp-member-src')
    let releaseFork!: () => void
    const gate = new Promise<void>((resolveGate) => { releaseFork = resolveGate })
    installForkMock({ gate })

    const copied = copyTeamConversation(fixture.conversationId)
    // 后台 fork 卡在 gate 上：第二次复制必须被防连点守卫拒绝
    expect(() => copyTeamConversation(fixture.conversationId)).toThrow('当前会话线正在复制中，请稍后')
    releaseFork()
    // 复制完成（fork 解析 + stage 清空都在守卫释放之前的同一次同步续延里）：
    const copiedMembers = teamConversationStore.listMembers(copied.id)
    await waitForCondition(() => {
      for (const grid of copiedMembers) {
        const row = sessionStore.get(grid.session_id!)
        expect(row?.acp_session_id).toBe(`acp-${grid.session_id}`)
        expect(row?.stage).toBe('')
      }
    })
    // 复制完成后守卫已释放：可以再次复制
    const again = copyTeamConversation(fixture.conversationId)
    expect(again.id).not.toBe(copied.id)
    await waitForCondition(() => {
      expect(teamConversationStore.listMembers(again.id).every((grid) => sessionStore.get(grid.session_id!)?.acp_session_id)).toBe(true)
    })
  })

  test('复制窗口守卫：COPYING_STAGE 格子拒收 prompt，fork 完成映射不被覆写（防孤儿）', async () => {
    const fixture = setupFixture()
    sessionStore.updateAcpSessionId(fixture.leaderGridSessionId, 'acp-leader-src')
    sessionStore.updateAcpSessionId(fixture.memberGridSessionId, 'acp-member-src')
    let releaseFork!: () => void
    const gate = new Promise<void>((resolveGate) => { releaseFork = resolveGate })
    installForkMock({ gate })
    // ensureSession 捕获：守卫生效时 prompt 绝不能建运行时映射；返回当前映射模拟「恢复既有会话」。
    const ensureCalls: string[] = []
    const originalEnsure = acpHost.ensureSession
    const originalPrompt = acpHost.prompt
    acpHost.ensureSession = (async (_agentId: string, sessionId: string) => {
      ensureCalls.push(sessionId)
      return sessionStore.get(sessionId)?.acp_session_id ?? 'acp-user-started'
    }) as typeof acpHost.ensureSession
    acpHost.prompt = (async () => undefined) as typeof acpHost.prompt

    const copied = copyTeamConversation(fixture.conversationId)
    const newMasterGrid = copied.master_session_id
    expect(sessionStore.get(newMasterGrid)?.acp_session_id).toBeNull()

    try {
      // 复制窗口内发消息：服务端拒绝（原缺陷：此处会经 ensureSession 写映射，随后被 fork 覆写成孤儿）
      await expect(sessionManager.sendPrompt(newMasterGrid, '你好，新线')).rejects.toThrow('正在复制')
      expect(ensureCalls).toHaveLength(0)

      releaseFork()
      await waitForCondition(() => {
        expect(sessionStore.get(newMasterGrid)?.acp_session_id).toBe(`acp-${newMasterGrid}`)
        expect(sessionStore.get(newMasterGrid)?.stage).toBe('')
      })

      // 复制完成自动放开：同一格子可送达运行时层，且映射保持 fork 结果（不被 ensureSession 顶掉）
      await sessionManager.sendPrompt(newMasterGrid, '复制完成后再发')
      expect(ensureCalls).toEqual([newMasterGrid])
      expect(sessionStore.get(newMasterGrid)?.acp_session_id).toBe(`acp-${newMasterGrid}`)
    } finally {
      acpHost.ensureSession = originalEnsure
      acpHost.prompt = originalPrompt
    }
  })

  test('leader primary 被复用为源线 master：复制后 primary 不动、新 master 是新格子', async () => {
    const fixture = setupFixture()
    sessionStore.updateAcpSessionId(fixture.leaderGridSessionId, 'acp-leader-src')
    sessionStore.updateAcpSessionId(fixture.memberGridSessionId, 'acp-member-src')
    installForkMock()

    const copied = copyTeamConversation(fixture.conversationId)
    const copiedMembers = teamConversationStore.listMembers(copied.id)
    const newLeaderGridId = copiedMembers.find((grid) => grid.member_id === fixture.leaderMemberId)!.session_id!

    await waitForCondition(() => {
      expect(sessionStore.get(newLeaderGridId)?.acp_session_id).toBe(`acp-${newLeaderGridId}`)
    })

    // 源 primary（= 源线 master，Leader 成员会话被首线复用）原样保留：未删除、acp 不变
    const sourcePrimary = sessionStore.get(fixture.leaderGridSessionId)
    expect(sourcePrimary?.deleted_at ?? null).toBeNull()
    expect(sourcePrimary?.acp_session_id).toBe('acp-leader-src')
    // Leader 成员行的会话指针不动
    expect(teamService.listMembers(fixture.teamId).find((entry) => entry.role === 'leader')?.session_id).toBe(fixture.leaderGridSessionId)
    // 新线 master 指向 Leader 的新格子，且新格子不是任何 primary
    expect(copied.master_session_id).toBe(newLeaderGridId)
    expect(sessionStore.get(newLeaderGridId)?.is_primary ?? 0).toBe(0)
    // 源线深链仍指向源线
    expect(teamConversationStore.getBySession(fixture.leaderGridSessionId)?.id).toBe(fixture.conversationId)
  })
})
