import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { teamStore, teamMemberStore } from '../../src/store/teams.js'
import { teamConversationStore } from '../../src/store/team-conversations.js'
import { teamService } from '../../src/core/teams.js'
import { teamConversationService, copyTeamConversation } from '../../src/core/team-conversations.js'
import { sessionManager } from '../../src/core/sessions.js'
import { dispatchMemberPrompt, cancelPendingForSessions } from '../../src/core/team-member-dispatcher.js'
import { events } from '../../src/core/events.js'
import { setRuntimePort } from '../../src/runtime/runtime-port-provider.js'
import type { RuntimePort } from '../../src/ports/runtime-port.js'

let tmp: string
let restorePort: (() => void) | undefined

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-conv-copy-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  restorePort?.()
  restorePort = undefined
  vi.restoreAllMocks()
  cancelPendingForSessions(allKnownSessionIds)
  allKnownSessionIds.clear()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

const allKnownSessionIds = new Set<string>()

function makeRuntimePortMock(overrides: Partial<Pick<RuntimePort, 'forkSession' | 'closeSession'>> = {}) {
  const forkSession = overrides.forkSession ?? vi.fn(async () => `acp-forked-${++forkSeq}`)
  const closeSession = overrides.closeSession ?? vi.fn(async () => undefined)
  restorePort = setRuntimePort({ forkSession, closeSession } as unknown as RuntimePort)
  return { forkSession, closeSession }
}
let forkSeq = 0

function createFixture() {
  const project = projectStore.create({ name: 'P', workDir: tmp })
  const leaderAgent = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
  const workerAgent = agentStore.create({ name: 'Worker', type: 'dev', runtime: 'mock', projectId: project.id })
  const created = teamService.create({
    projectId: project.id,
    leaderAgentId: leaderAgent.id,
    name: 'Alpha',
  })
  // teamService.create 会复制 agent 并自建 leader session：返回值里的 session 才是 leader 成员的 primary session
  const member = teamService.spawnMember({ teamId: created.team.id, agentId: workerAgent.id, name: 'Worker' }).member
  const detail = teamConversationService.createConversation(created.team.id, '服务器体检')
  const grids = teamConversationStore.listMembers(detail.conversation.id)
  for (const grid of grids) allKnownSessionIds.add(grid.session_id!)
  return { project, team: created.team, member, conversation: detail.conversation, grids, leaderSession: created.session }
}

/** 格子辅助：按成员名找格子 session。 */
function gridOf(fixture: ReturnType<typeof createFixture>, name: 'Leader' | 'Worker'): string | null {
  const teamMembers = teamService.listMembers(fixture.team.id)
  const member = teamMembers.find((m) => m.name === name)
  const grid = fixture.grids.find((g) => g.member_id === member?.id)
  return grid?.session_id ?? null
}

function heatGrid(sessionId: string): void {
  sessionStore.updateAcpSessionId(sessionId, `acp-src-${sessionId}`)
}

describe('copyTeamConversation', () => {
  test('复制活跃线：Master + 全部成员格子 fork 成新线，新线转录为空、原线零变化', async () => {
    const fixture = createFixture()
    const leaderGrid = gridOf(fixture, 'Leader')!
    const workerGrid = gridOf(fixture, 'Worker')!
    heatGrid(leaderGrid)
    heatGrid(workerGrid)
    makeRuntimePortMock()

    const beforeLeader = sessionStore.get(leaderGrid)
    const beforeWorker = sessionStore.get(workerGrid)
    const beforeConversation = { ...fixture.conversation }

    const copied = copyTeamConversation(fixture.conversation.id)

    // 新线行：独立 id、标题带（副本）、master 指向 leader 的新格子
    expect(copied.id).not.toBe(fixture.conversation.id)
    expect(copied.title).toBe('服务器体检（副本）')
    expect(copied.team_id).toBe(fixture.team.id)
    expect(copied.status).toBe('active')
    const newGrids = teamConversationStore.listMembers(copied.id)
    expect(newGrids).toHaveLength(2)
    const copiedLeaderGrid = newGrids.find((g) => g.session_id === copied.master_session_id)
    expect(copiedLeaderGrid).toBeTruthy()

    for (const grid of newGrids) {
      const row = sessionStore.get(grid.session_id!)!
      expect(row.id).not.toBe(leaderGrid)
      expect(row.id).not.toBe(workerGrid)
      expect(row.last_message_at).toBeNull()
    }

    // 后台 fork 完成后：新格子在运行时层确实被 fork（有 acp_session_id）且 stage 清空，格子-线反查成立
    await vi.waitFor(() => {
      for (const grid of newGrids) {
        const row = sessionStore.get(grid.session_id!)!
        expect(row.acp_session_id).toBeTruthy()
        expect(row.stage).toBe('')
      }
      expect(teamConversationStore.getBySession(copied.master_session_id)?.id).toBe(copied.id)
    })

    // 原线零变化：源格子行、源线行逐字段不变
    expect(sessionStore.get(leaderGrid)).toEqual(beforeLeader)
    expect(sessionStore.get(workerGrid)).toEqual(beforeWorker)
    expect(teamConversationStore.get(fixture.conversation.id)).toEqual(beforeConversation)
  })

  test('runtime_preferences 随迁：fork 发生时新格子 preferences 已与源格子一致', async () => {
    const fixture = createFixture()
    const workerGrid = gridOf(fixture, 'Worker')!
    heatGrid(workerGrid)
    const prefs = { modelId: 'glm-5.3-flash', modeId: 'default', config: { effort: 'high' } }
    sessionStore.updateRuntimePreferences(workerGrid, prefs)

    const prefsAtFork: Record<string, unknown>[] = []
    makeRuntimePortMock({
      forkSession: vi.fn(async (snapshot: { session: { id: string } }) => {
        prefsAtFork.push(sessionStore.getRuntimePreferences(snapshot.session.id))
        return `acp-forked-${++forkSeq}`
      }),
    })

    const copied = copyTeamConversation(fixture.conversation.id)
    const newGrids = teamConversationStore.listMembers(copied.id)
    const newWorkerGrid = newGrids.map((g) => g.session_id!).find((id) => id !== copied.master_session_id)!

    // 仅 worker 格子是热的 → fork 恰好 1 次，且 fork 发生时新格子 preferences 已随迁
    await vi.waitFor(() => expect(prefsAtFork).toHaveLength(1))
    expect(prefsAtFork[0]).toEqual(prefs)
    expect(sessionStore.getRuntimePreferences(newWorkerGrid)).toEqual(prefs)
  })

  test('冷格子降级：源格子无 acp_session_id 时跳过 fork 直接空建', async () => {
    const fixture = createFixture()
    const leaderGrid = gridOf(fixture, 'Leader')!
    heatGrid(leaderGrid)
    const workerGrid = gridOf(fixture, 'Worker')!
    // worker 格子保持冷（从未跑过 prompt）
    const { forkSession } = makeRuntimePortMock()

    const copied = copyTeamConversation(fixture.conversation.id)
    const newGrids = teamConversationStore.listMembers(copied.id)
    expect(newGrids).toHaveLength(2)

    await vi.waitFor(() => expect(forkSession).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => {
      const newWorkerGrid = newGrids.map((g) => g.session_id!).find((id) => id !== copied.master_session_id)!
      expect(sessionStore.get(newWorkerGrid)?.acp_session_id).toBeNull()
      expect(sessionStore.get(newWorkerGrid)?.stage).toBe('')
    })
  })

  test('忙线拒绝：任一格子 isPromptActive 时拒绝复制', () => {
    const fixture = createFixture()
    heatGrid(gridOf(fixture, 'Leader')!)
    makeRuntimePortMock()
    const promptActive = vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(true)

    expect(() => copyTeamConversation(fixture.conversation.id)).toThrow('团队会话正在运行或有排队消息，空闲后再复制')
    expect(promptActive).toHaveBeenCalled()
  })

  test('忙线拒绝：格子只有排队消息（未在跑）同样拒绝——排队探针独立生效', () => {
    const fixture = createFixture()
    const workerGrid = gridOf(fixture, 'Worker')!
    heatGrid(gridOf(fixture, 'Leader')!)
    makeRuntimePortMock()

    // isPromptActive=true 时派发只会入队不会开跑；随后恢复，留下纯排队状态
    const promptActive = vi.spyOn(sessionManager, 'isPromptActive')
    promptActive.mockReturnValue(true)
    const member = teamService.listMembers(fixture.team.id).find((m) => m.name === 'Worker')!
    const status = dispatchMemberPrompt({ teamId: fixture.team.id, memberId: member.id, sessionId: workerGrid, prompt: '排队中的指令' })
    expect(status).toBe('queued')
    promptActive.mockRestore()
    expect(sessionManager.isPromptActive(workerGrid)).toBe(false)

    expect(() => copyTeamConversation(fixture.conversation.id)).toThrow('团队会话正在运行或有排队消息，空闲后再复制')
    expect(teamConversationStore.list(fixture.team.id).some((c) => c.status === 'deleted')).toBe(false)
  })

  test('防连点：源线复制进行中时第二次复制被拒', async () => {
    const fixture = createFixture()
    heatGrid(gridOf(fixture, 'Leader')!)
    heatGrid(gridOf(fixture, 'Worker')!)
    // 挂起所有 fork 调用，手动统一释放（fork 逐格子顺序调用，单变量会被第二次调用覆盖）
    const resolvers: ((value: string) => void)[] = []
    makeRuntimePortMock({
      forkSession: vi.fn(() => new Promise<string>((resolvePromise) => { resolvers.push(resolvePromise) })),
    })

    copyTeamConversation(fixture.conversation.id)
    expect(() => copyTeamConversation(fixture.conversation.id)).toThrow('当前会话线正在复制中，请稍后')

    await vi.waitFor(() => {
      // fork 逐格子顺序挂起：每轮先释放已挂起的调用（释放 leader 后 worker 的 fork 才发起）
      while (resolvers.length) resolvers.splice(0).forEach((resolve) => resolve(`acp-forked-${++forkSeq}`))
      // 复制完成后防连点解除（再次复制应不再报"正在复制中"）
      expect(() => copyTeamConversation(fixture.conversation.id)).not.toThrow('当前会话线正在复制中，请稍后')
    })
  })

  test('失败整线回滚：任一格子 fork 失败 → 新格子全部删除 + 新线置 deleted + 失败事件', async () => {
    const fixture = createFixture()
    heatGrid(gridOf(fixture, 'Leader')!)
    heatGrid(gridOf(fixture, 'Worker')!)
    makeRuntimePortMock({
      forkSession: vi.fn()
        .mockResolvedValueOnce(`acp-forked-${++forkSeq}`)
        .mockRejectedValueOnce(new Error('fork boom')),
    })
    const teamUpdates: { teamId: string; sessionIds: string[]; data: Record<string, unknown> }[] = []
    const onTeamUpdate = (msg: { teamId: string; sessionIds: string[]; data: Record<string, unknown> }): void => { teamUpdates.push(msg) }
    events.on('team:update', onTeamUpdate)

    const copied = copyTeamConversation(fixture.conversation.id)

    await vi.waitFor(() => {
      expect(teamConversationStore.get(copied.id)?.status).toBe('deleted')
    })
    // 整线 all-or-nothing：不留半截线，新格子行全部软删除（sessionStore.delete 置 deleted_at）
    for (const grid of teamConversationStore.listMembers(copied.id)) {
      expect(sessionStore.get(grid.session_id!)?.deleted_at).toBeTruthy()
    }
    // 回滚事件带失败原因供 UI 提示
    const failure = teamUpdates.find((msg) => (msg.data as { reason?: string } | undefined)?.reason === 'conversation.copy_failed')
    expect((failure?.data as { message?: string } | undefined)?.message).toContain('fork boom')
    // 原线不受影响
    expect(teamConversationStore.get(fixture.conversation.id)?.status).toBe('active')
  })

  test('回滚时对新格子调用 closeSession 释放运行时资源', async () => {
    const fixture = createFixture()
    heatGrid(gridOf(fixture, 'Leader')!)
    heatGrid(gridOf(fixture, 'Worker')!)
    const { closeSession } = makeRuntimePortMock({
      forkSession: vi.fn().mockRejectedValue(new Error('first grid fails')),
    })

    const copied = copyTeamConversation(fixture.conversation.id)
    const newGridIds = teamConversationStore.listMembers(copied.id).map((g) => g.session_id!)

    await vi.waitFor(() => expect(teamConversationStore.get(copied.id)?.status).toBe('deleted'))
    expect(closeSession).toHaveBeenCalledTimes(newGridIds.length)
  })

  test('leader primary session 即 master 格子的形态：复制后新线 master 是 leader 的新格子而非源 primary', async () => {
    const fixture = createFixture()
    // createConversation 首次开线复用 leader primary session 作为 master 格子
    const leaderGrid = gridOf(fixture, 'Leader')!
    expect(leaderGrid).toBe(fixture.leaderSession.id)
    heatGrid(leaderGrid)
    heatGrid(gridOf(fixture, 'Worker')!)
    makeRuntimePortMock()

    const copied = copyTeamConversation(fixture.conversation.id)
    const newGrids = teamConversationStore.listMembers(copied.id)

    expect(copied.master_session_id).not.toBe(fixture.leaderSession.id)
    expect(newGrids.map((g) => g.session_id)).toContain(copied.master_session_id)
    expect(teamConversationStore.getBySession(copied.master_session_id)?.id).toBe(copied.id)
  })

  test('非活跃线不可复制', () => {
    const fixture = createFixture()
    teamConversationService.archiveConversation(fixture.conversation.id)
    makeRuntimePortMock()
    expect(() => copyTeamConversation(fixture.conversation.id)).toThrow('仅活跃中的会话线可以复制')
  })

  test('已移除成员的历史格子不进新线', () => {
    const fixture = createFixture()
    const workerGrid = gridOf(fixture, 'Worker')!
    teamMemberStore.remove(fixture.member.id)
    heatGrid(gridOf(fixture, 'Leader')!)
    makeRuntimePortMock()

    const copied = copyTeamConversation(fixture.conversation.id)
    const newGrids = teamConversationStore.listMembers(copied.id)
    expect(newGrids).toHaveLength(1)
    expect(newGrids.map((g) => g.session_id)).not.toContain(workerGrid)
  })
})
