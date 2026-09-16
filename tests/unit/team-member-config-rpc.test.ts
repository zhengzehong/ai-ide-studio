import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { ensureMemberInConversation } from '../../src/core/team-conversations.js'
import { sessionManager } from '../../src/core/sessions.js'
import { teamService } from '../../src/core/teams.js'
import { modelProfileStore } from '../../src/store/model-profiles.js'
import { modelProviderStore } from '../../src/store/model-providers.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { teamConversationStore } from '../../src/store/team-conversations.js'
import { teamMemberStore, teamStore } from '../../src/store/teams.js'
import { teamRpcHandlers } from '../../src/gateway/rpc/teams.js'

let tmp: string

beforeEach(() => {
  closeDatabase()
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-member-config-'))
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

interface Fixture {
  teamId: string
  leaderMemberId: string
  leaderSessionId: string
  memberId: string
  memberSessionId: string
  profileId: string
}

function setup(): Fixture {
  const project = projectStore.create({ name: 'project', workDir: tmp })
  const provider = modelProviderStore.create({
    name: 'provider',
    displayName: 'provider',
    protocol: 'claude',
    baseUrl: 'https://example.com',
    apiKey: 'sk-test',
  })
  const profile = modelProfileStore.create({
    name: 'leader-profile',
    runtime: 'claude',
    providerId: provider.id,
    config: { defaultModel: 'claude-model' },
  })
  const team = teamStore.create({ projectId: project.id, name: '双人并行开发' })
  const leaderAgent = agentStore.create({ name: 'Master', type: 'coder', runtime: 'claude', projectId: project.id })
  const leaderSession = sessionStore.create({ agentId: leaderAgent.id, projectId: project.id })
  const leader = teamMemberStore.create({
    teamId: team.id, projectId: project.id, agentId: leaderAgent.id, sessionId: leaderSession.id,
    name: 'Master', role: 'leader', modelProfileId: profile.id, modelProfileMode: 'fixed',
  })
  const memberAgent = agentStore.create({ name: 'Dev-GLM', type: 'coder', runtime: 'claude', projectId: project.id })
  const memberSession = sessionStore.create({ agentId: memberAgent.id, projectId: project.id })
  const member = teamMemberStore.create({
    teamId: team.id, projectId: project.id, agentId: memberAgent.id, sessionId: memberSession.id,
    name: 'Dev-GLM', role: 'member',
  })
  return { teamId: team.id, leaderMemberId: leader.id, leaderSessionId: leaderSession.id, memberId: member.id, memberSessionId: memberSession.id, profileId: profile.id }
}

function callRpc(type: keyof typeof teamRpcHandlers, msg: Record<string, unknown>, authMode: 'owner' | 'member' = 'owner'): unknown {
  let result: unknown
  teamRpcHandlers[type](msg as never, {
    state: { subscriptions: new Set(), authMode },
    sendResult: (data) => { result = data },
    sendError: () => undefined,
    sendOutOfBandError: () => undefined,
  })
  return result
}

describe('team member config RPC', () => {
  test('member inherits the leader fixed profile by default and the history payload carries modelConfig', () => {
    const f = setup()
    const conversation = teamConversationStore.create(f.teamId, f.leaderSessionId, '线一')

    const config = callRpc('team.member.config.get', { memberId: f.memberId }) as { modelProfileMode: string; effective: { name: string; source: string } }
    expect(config.modelProfileMode).toBe('inherit')
    expect(config.effective).toEqual({ name: 'leader-profile', source: '继承 Master' })

    const detail = callRpc('team.conversation.history', { conversationId: conversation.id }) as { members: Array<{ id: string; modelConfig?: { effective: { source: string } } }> }
    const enriched = detail.members.find((member) => member.id === f.memberId)
    expect(enriched?.modelConfig?.effective).toEqual({ name: 'leader-profile', source: '继承 Master' })
    const leader = detail.members.find((member) => member.id === f.leaderMemberId)
    expect(leader?.modelConfig?.effective).toEqual({ name: 'leader-profile', source: 'Master 档案' })
  })

  test('fixed mode resolves the member profile as 独立配置 and persists for the next turn', () => {
    const f = setup()
    const provider = modelProviderStore.list()[0]
    const memberProfile = modelProfileStore.create({
      name: 'member-profile', runtime: 'claude', providerId: provider.id, config: { defaultModel: 'member-model' },
    })

    const updated = callRpc('team.member.config.update', {
      memberId: f.memberId, modelProfileMode: 'fixed', modelProfileId: memberProfile.id, systemPromptOverride: '专注客户端审查',
    }) as { modelProfileMode: string; modelProfileId: string; systemPromptOverride: string; effective: { source: string } }

    expect(updated).toMatchObject({ modelProfileMode: 'fixed', modelProfileId: memberProfile.id, systemPromptOverride: '专注客户端审查' })
    expect(updated.effective).toEqual({ name: 'member-profile', source: '独立配置' })

    const stored = teamMemberStore.get(f.memberId)
    expect(stored).toMatchObject({ model_profile_id: memberProfile.id, model_profile_mode: 'fixed', system_prompt_override: '专注客户端审查' })
  })

  test('inherit mode clears the profile so the next turn falls back to the leader chain', () => {
    const f = setup()
    callRpc('team.member.config.update', { memberId: f.memberId, modelProfileMode: 'fixed', modelProfileId: f.profileId })
    const reverted = callRpc('team.member.config.update', { memberId: f.memberId, modelProfileMode: 'inherit', systemPromptOverride: '' }) as { modelProfileId: string | null; systemPromptOverride: string | null; effective: { source: string } }

    expect(reverted.modelProfileId).toBeNull()
    expect(reverted.systemPromptOverride).toBeNull()
    expect(reverted.effective).toEqual({ name: 'leader-profile', source: '继承 Master' })
    expect(teamMemberStore.get(f.memberId)).toMatchObject({ model_profile_id: null, model_profile_mode: 'inherit' })
  })

  test('system mode skips the master chain and resolves system default for plain agents', () => {
    const f = setup()
    const updated = callRpc('team.member.config.update', { memberId: f.memberId, modelProfileMode: 'system' }) as { effective: { name: string; source: string } }
    expect(updated.effective).toEqual({ name: '系统默认', source: '未指定档案' })
  })

  test('fallback resolution follows the member agent own config (P1: agent_id, not runtime string)', () => {
    const f = setup()
    const provider = modelProviderStore.list()[0]
    const agentProfile = modelProfileStore.create({
      name: 'agent-own-profile', runtime: 'claude', providerId: provider.id, config: { defaultModel: 'agent-model' },
    })
    const memberAgent = agentStore.list().find((agent) => agent.id === teamMemberStore.get(f.memberId)?.agent_id)!
    agentStore.update(memberAgent.id, { config: { modelProfileId: agentProfile.id } })

    // system 模式：成员档案与 Master 档案都不生效 → Agent 原配置（来源标注 Agent 配置）。
    const updated = callRpc('team.member.config.update', { memberId: f.memberId, modelProfileMode: 'system' }) as {
      effective: { name: string; source: string }
      fallback: { name: string; source: string }
    }
    expect(updated.effective).toEqual({ name: 'agent-own-profile', source: 'Agent 配置' })
    expect(updated.fallback).toEqual({ name: 'agent-own-profile', source: 'Agent 配置' })
  })

  test('member config RPC requires owner auth and rejects removed members', () => {
    const f = setup()
    expect(() => callRpc('team.member.config.get', { memberId: f.memberId }, 'member')).toThrow('仅所有者可管理团队成员配置')
    expect(() => callRpc('team.member.config.update', { memberId: f.memberId, modelProfileMode: 'system' }, 'member')).toThrow('仅所有者可管理团队成员配置')
    expect(() => callRpc('team.member.remove', { memberId: f.memberId }, 'member')).toThrow('仅所有者可管理团队成员配置')

    expect(callRpc('team.member.remove', { memberId: f.memberId })).toEqual({ ok: true })
    expect(() => callRpc('team.member.config.get', { memberId: f.memberId })).toThrow('成员已从团队移除')
    expect(() => callRpc('team.member.config.update', { memberId: f.memberId, modelProfileMode: 'system' })).toThrow('成员已从团队移除')
    expect(() => callRpc('team.member.remove', { memberId: f.memberId })).toThrow('成员已从团队移除')
  })

  test('rejects a profile from another runtime and a fixed mode without a profile', () => {
    const f = setup()
    const provider = modelProviderStore.list()[0]
    const codexProfile = modelProfileStore.create({
      name: 'codex-profile', runtime: 'codex', providerId: provider.id, config: { model: 'codex-model' },
    })
    expect(() => callRpc('team.member.config.update', { memberId: f.memberId, modelProfileMode: 'fixed', modelProfileId: codexProfile.id }))
      .toThrow('模型档案运行时与成员 Agent 运行时不匹配')
    expect(() => callRpc('team.member.config.update', { memberId: f.memberId, modelProfileMode: 'fixed' }))
      .toThrow('modelProfileId 不能为空')
  })

  test('removes a member relation only, keeps history intact and allows re-adding the agent', () => {
    const f = setup()
    expect(callRpc('team.member.remove', { memberId: f.memberId })).toEqual({ ok: true })
    expect(teamMemberStore.list(f.teamId).map((member) => member.id)).toEqual([f.leaderMemberId])

    const project = projectStore.list()[0]
    const memberAgent = agentStore.list().find((agent) => agent.name === 'Dev-GLM')!
    // (team_id, agent_id) 唯一：重新添加复原始关系行（id 不变），保证历史连续。
    const reAdded = teamMemberStore.create({
      teamId: f.teamId, projectId: project.id, agentId: memberAgent.id, sessionId: f.memberSessionId, name: 'Dev-GLM', role: 'member',
    })
    expect(reAdded.id).toBe(f.memberId)
    expect(teamMemberStore.list(f.teamId).map((member) => member.id)).toContain(f.memberId)
  })

  test('refuses to remove the master and rejects unknown members', () => {
    const f = setup()
    expect(() => callRpc('team.member.remove', { memberId: f.leaderMemberId })).toThrow('Master 为团队主控，不可移除')
    expect(() => callRpc('team.member.config.get', { memberId: 'tm-missing' })).toThrow('Team member 不存在')
  })

  test('returns the member agent real system prompt, including values configured at spawn time', () => {
    const f = setup()
    // Master 用 team_member_spawn 配置了 systemPrompt 的成员：真实原值必须回传。
    const spawned = teamService.spawnMember({
      teamId: f.teamId, name: '检查员-C', type: 'coder', runtime: 'claude', systemPrompt: 'Master 配置的检查员人设',
    })
    const spawnConfig = callRpc('team.member.config.get', { memberId: spawned.member.id }) as { agentSystemPrompt: string | null }
    expect(spawnConfig.agentSystemPrompt).toBe('Master 配置的检查员人设')

    // Agent 定义后续修改：预览跟随真实值；未设置则为 null。
    const memberAgentId = teamMemberStore.get(f.memberId)!.agent_id
    agentStore.update(memberAgentId, { systemPrompt: '成员原始人设提示词' })
    const updated = callRpc('team.member.config.get', { memberId: f.memberId }) as { agentSystemPrompt: string | null }
    expect(updated.agentSystemPrompt).toBe('成员原始人设提示词')

    agentStore.update(memberAgentId, { systemPrompt: '' })
    const cleared = callRpc('team.member.config.get', { memberId: f.memberId }) as { agentSystemPrompt: string | null }
    expect(cleared.agentSystemPrompt).toBeNull()
  })

  test('returns the agent definition raw model profile id for the leader prefill', () => {
    const f = setup()
    // 未在 Agent 定义里配置档案 → null（弹窗空选项=使用系统默认）。
    const leaderAgentId = teamMemberStore.get(f.leaderMemberId)!.agent_id
    const initial = callRpc('team.member.config.get', { memberId: f.leaderMemberId }) as { agentModelProfileId: string | null }
    expect(initial.agentModelProfileId).toBeNull()

    // 与普通 Agent 设置弹窗同一条链写入（agents.update → config_json.modelProfileId）后回传原值。
    const provider = modelProviderStore.list()[0]
    const agentProfile = modelProfileStore.create({
      name: 'leader-agent-profile', runtime: 'claude', providerId: provider.id, config: { defaultModel: 'leader-agent-model' },
    })
    agentStore.update(leaderAgentId, { config: { modelProfileId: agentProfile.id } })
    const updated = callRpc('team.member.config.get', { memberId: f.leaderMemberId }) as { agentModelProfileId: string | null }
    expect(updated.agentModelProfileId).toBe(agentProfile.id)

    // 外部成员同样下发（类型统一，成员分支不用它预填）。
    const memberAgentId = teamMemberStore.get(f.memberId)!.agent_id
    agentStore.update(memberAgentId, { config: { modelProfileId: agentProfile.id } })
    const memberConfig = callRpc('team.member.config.get', { memberId: f.memberId }) as { agentModelProfileId: string | null }
    expect(memberConfig.agentModelProfileId).toBe(agentProfile.id)
  })

  test('removed member stays in the conversation payload so history survives re-entry', () => {
    const f = setup()
    const conversation = teamConversationStore.create(f.teamId, f.leaderSessionId, '线一')
    const gridSessionId = ensureMemberInConversation(conversation.id, teamMemberStore.get(f.memberId)!)
    expect(callRpc('team.member.remove', { memberId: f.memberId })).toEqual({ ok: true })

    const detail = callRpc('team.conversation.history', { conversationId: conversation.id }) as {
      members: Array<{ id: string }>
      removedMembers?: Array<{ id: string; session_id: string; status: string }>
    }
    // 活跃成员列表不含被移除者（dock 不再显示），但其格子会话仍随会话线下发，聚合视图可继续加载历史。
    expect(detail.members.map((member) => member.id)).not.toContain(f.memberId)
    const retained = detail.removedMembers?.find((member) => member.id === f.memberId)
    expect(retained?.session_id).toBe(gridSessionId)
    expect(retained?.status).toBe('removed')
  })

  test('member effort defaults to null (follow profile) and round-trips through config update', () => {
    const f = setup()
    const initial = callRpc('team.member.config.get', { memberId: f.memberId }) as { effort: string | null }
    expect(initial.effort).toBeNull()

    const set = callRpc('team.member.config.update', {
      memberId: f.memberId, modelProfileMode: 'inherit', systemPromptOverride: '', effort: 'max',
    }) as { effort: string | null }
    expect(set.effort).toBe('max')
    expect(teamMemberStore.get(f.memberId)?.reasoning_effort).toBe('max')

    // 缺省 effort 不动既有值：只改模型策略的写入不能悄悄清掉成员默认档。
    const untouched = callRpc('team.member.config.update', { memberId: f.memberId, modelProfileMode: 'inherit' }) as { effort: string | null }
    expect(untouched.effort).toBe('max')

    // 空串=清空 → NULL（跟随模型档案）。
    const cleared = callRpc('team.member.config.update', { memberId: f.memberId, modelProfileMode: 'inherit', effort: '' }) as { effort: string | null }
    expect(cleared.effort).toBeNull()
    expect(teamMemberStore.get(f.memberId)?.reasoning_effort).toBeNull()
  })

  test('rejects an effort value outside the capability whitelist', () => {
    const f = setup()
    expect(() => callRpc('team.member.config.update', { memberId: f.memberId, modelProfileMode: 'inherit', effort: 'turbo' }))
      .toThrow('档位取值非法')
    expect(teamMemberStore.get(f.memberId)?.reasoning_effort).toBeNull()
  })

  test('directed message RPC dispatches through the member FIFO with the 你 signature', () => {
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    const f = setup()
    const result = callRpc('team.member.message', { memberId: f.memberId, content: '看下这个报错' }) as { status: string; memberId: string; memberName: string }

    expect(result).toEqual({ status: 'accepted', memberId: f.memberId, memberName: 'Dev-GLM' })
    expect(enqueue).toHaveBeenCalledTimes(1)
    const [sessionId, displayContent, , options] = enqueue.mock.calls[0] as unknown as [string, string, unknown, { modelContent: string; senderRole: string; senderName: string }]
    // 转录块显示原文、署「你」，模型载荷走定向变体（绕过 Master 编排）。
    expect(sessionId).toBe(f.memberSessionId)
    expect(displayContent).toBe('看下这个报错')
    expect(options.senderRole).toBe('team-directed')
    expect(options.senderName).toBe('你')
    expect(options.modelContent).toContain('绕过 Master 编排')
    expect(options.modelContent).toContain('看下这个报错')
  })

  test('directed message returns queued when the member is already running (FIFO, no loss)', () => {
    vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(true)
    const f = setup()
    const result = callRpc('team.member.message', { memberId: f.memberId, content: '排队消息' }) as { status: string }
    expect(result.status).toBe('queued')
  })

  test('directed message requires owner auth, content and an active member', () => {
    const f = setup()
    expect(() => callRpc('team.member.message', { memberId: f.memberId, content: 'x' }, 'member')).toThrow('仅所有者可管理团队成员配置')
    expect(() => callRpc('team.member.message', { memberId: f.memberId, content: '   ' })).toThrow('content 不能为空')
    expect(() => callRpc('team.member.message', { memberId: 'tm-missing', content: 'x' })).toThrow('Team member 不存在')
  })
})
