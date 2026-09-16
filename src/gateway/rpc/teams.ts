import { teamService } from '../../core/teams.js'
import { sessionManager } from '../../core/sessions.js'
import type { RpcHandlerMap } from './types.js'
import { modelProfileStore } from '../../store/model-profiles.js'
import { getGlobalModelProfile, readModelProfileId } from '../../acp/runtime-global-model-profile.js'
import { resolveAgentModelProfile } from '../../acp/model-profile-env.js'
import { agentStore } from '../../store/agents.js'
import { teamMemberStore, type TeamMemberRow } from '../../store/teams.js'
import { events } from '../../core/events.js'
import { markTeamConversationRead, markTeamConversationUnread } from '../../core/team-conversation-read.js'

export type TeamMemberModelProfileMode = 'inherit' | 'fixed' | 'system'

export interface TeamMemberEffectiveModel {
  name: string
  source: string
}

export interface TeamMemberModelConfig {
  modelProfileMode: TeamMemberModelProfileMode
  modelProfileId: string | null
  systemPromptOverride: string | null
  /** 成员级默认档位（migration 072）：null=跟随档案/系统默认。本会话内手切过的档位仍以手切优先。 */
  effort: string | null
  runtime: string
  effective: TeamMemberEffectiveModel
  /** 不继承任何档案时的解析结果（Agent 原配置 → 系统默认），供「使用系统默认」策略在弹窗内预览。 */
  fallback: TeamMemberEffectiveModel
  /** 成员 Agent 定义当前真实生效的原始 system_prompt（含 Master spawn 时配置的值），空则 null；供弹窗「当前提示词」回显。 */
  agentSystemPrompt: string | null
  /** Agent 定义 config_json 里的原始 model_profile_id，空则 null；供 Master 弹窗预填（模型档案直改 Agent 定义）。 */
  agentModelProfileId: string | null
}

export const teamRpcHandlers: RpcHandlerMap = {
  'teams.defaults'(_msg, { sendResult }) {
    const profiles = modelProfileStore.list({ runtime: 'claude', enabledOnly: true }).map((profile) => ({
      id: profile.id,
      name: profile.name,
      providerId: profile.provider_id,
      isDefault: profile.is_default === 1,
    }))
    const global = getGlobalModelProfile('claude')
    sendResult({
      masterPrompt: teamService.describeTemplate('tpl-team-leader').system_prompt,
      modelProfiles: profiles,
      defaultModelProfileId: profiles.find((profile) => profile.isDefault)?.id || profiles[0]?.id || null,
      globalModelProfileId: global.enabled ? global.profileId || null : null,
    })
  },
  'teams.create'(msg, { sendResult }) {
    sendResult(teamService.create({
      projectId: requiredText(msg.projectId, 'projectId'),
      name: requiredText(msg.name, 'name'),
      description: typeof msg.description === 'string' ? msg.description : undefined,
      masterPrompt: typeof msg.masterPrompt === 'string' ? msg.masterPrompt : undefined,
      modelProfileId: typeof msg.modelProfileId === 'string' ? msg.modelProfileId : undefined,
    }))
  },
  'teams.list'(msg, { sendResult }) {
    const projectId = typeof msg.projectId === 'string' ? msg.projectId : undefined
    sendResult(teamService.list(projectId))
  },
  'teams.update'(msg, { sendResult }) {
    sendResult(teamService.update(requiredText(msg.teamId, 'teamId'), {
      name: typeof msg.name === 'string' && msg.name.trim() ? msg.name.trim() : undefined,
      description: typeof msg.description === 'string' ? msg.description : undefined,
      masterPrompt: typeof msg.masterPrompt === 'string' ? msg.masterPrompt : undefined,
    }))
  },
  'teams.archive'(msg, { sendResult }) {
    sendResult(teamService.archive(requiredText(msg.teamId, 'teamId')))
  },
  'teams.detail'(msg, { sendResult }) {
    const teamId = requiredText(msg.teamId, 'teamId')
    sendResult(teamService.detail(teamId))
  },
  'team.conversation.list'(msg, { sendResult }) {
    sendResult(teamService.listConversations(
      requiredText(msg.teamId, 'teamId'),
      (sessionId) => sessionManager.isPromptActive(sessionId),
    ))
  },
  'team.conversation.create'(msg, { sendResult }) {
    sendResult(teamService.createConversation(requiredText(msg.teamId, 'teamId'), typeof msg.title === 'string' ? msg.title : undefined))
  },
  // 深链反查（仅 master session 命中）：坞里点团队线、带 sessionId 的链接显式进团队线视图。
  'team.conversation.bySession'(msg, { state, sendResult }) {
    if (state.authMode !== 'owner') throw new Error('访客无权查看团队会话线')
    sendResult(teamService.conversationByMasterSession(
      requiredText(msg.sessionId, 'sessionId'),
      (sessionId) => sessionManager.isPromptActive(sessionId),
    ))
  },
  'team.conversation.history'(msg, { sendResult }) {
    const detail = teamService.conversationDetail(requiredText(msg.conversationId, 'conversationId'))
    // 生效模型来源由后端解析后随成员下发，前端只展示不计算。
    sendResult({ ...detail, members: detail.members.map((member) => ({ ...member, modelConfig: describeTeamMemberModelConfig(member) })) })
  },
  'team.conversation.markRead'(msg, { sendResult }) {
    sendResult(markTeamConversationRead(requiredText(msg.conversationId, 'conversationId'), msg.messages))
  },
  'team.conversation.markUnread'(msg, { state, sendResult }) {
    if (state.authMode !== 'owner') throw new Error('仅所有者可标记未读')
    sendResult(markTeamConversationUnread(requiredText(msg.conversationId, 'conversationId')))
  },
  'team.conversation.rename'(msg, { sendResult }) {
    sendResult(teamService.renameConversation(requiredText(msg.conversationId, 'conversationId'), requiredText(msg.title, 'title')))
  },
  'team.conversation.archive'(msg, { sendResult }) {
    sendResult(teamService.archiveConversation(requiredText(msg.conversationId, 'conversationId')))
  },
  // 复制团队会话线（Master + 全部成员格子 fork；空闲线限定，忙线拒绝）：立即返回新线占位，fork 后台推进。
  'team.conversation.copy'(msg, { state, sendResult }) {
    requireOwner(state)
    sendResult({ conversation: teamService.copyConversation(requiredText(msg.conversationId, 'conversationId')) })
  },
  'team.conversation.delete'(msg, { sendResult }) {
    sendResult(teamService.deleteConversation(requiredText(msg.conversationId, 'conversationId')))
  },
  'teams.current'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string | undefined
    if (!sessionId) throw new Error('sessionId 不能为空')
    sendResult(teamService.currentBySession(sessionId))
  },
  'team.member.config.get'(msg, { state, sendResult }) {
    requireOwner(state)
    sendResult(describeTeamMemberModelConfig(requireActiveTeamMember(requiredText(msg.memberId, 'memberId'))))
  },
  'team.member.config.update'(msg, { state, sendResult }) {
    requireOwner(state)
    const member = requireActiveTeamMember(requiredText(msg.memberId, 'memberId'))
    const mode = normalizeModelProfileMode(msg.modelProfileMode)
    // 固定档案必须存在、启用且与成员 Agent 运行时匹配；inherit/system 不绑定档案（留空则按解析链回退）。
    const modelProfileId = mode === 'fixed' ? requiredText(msg.modelProfileId, 'modelProfileId') : null
    if (modelProfileId) assertProfileUsable(modelProfileId, memberRuntime(member))
    const systemPromptOverride = typeof msg.systemPromptOverride === 'string' && msg.systemPromptOverride.trim().length > 0
      ? msg.systemPromptOverride
      : null
    // 成员级默认档位（P0 数据基座）：null/缺省=不动；空串=清空（跟随档案）；合法档位值=写入。
    const reasoningEffort = msg.effort === undefined
      ? undefined
      : msg.effort === null || msg.effort === ''
        ? null
        : normalizeMemberEffort(msg.effort)
    const updated = teamMemberStore.updateConfig(member.id, { modelProfileMode: mode, modelProfileId, systemPromptOverride, reasoningEffort })
    if (!updated) throw new Error(`Team member 不存在: ${member.id}`)
    emitTeamUpdate(updated.team_id, 'member.updated')
    sendResult(describeTeamMemberModelConfig(updated))
  },
  'team.member.remove'(msg, { state, sendResult }) {
    requireOwner(state)
    const member = requireActiveTeamMember(requiredText(msg.memberId, 'memberId'))
    if (member.role === 'leader') throw new Error('Master 为团队主控，不可移除')
    // 仅解除团队关系：不删项目 Agent、不删历史消息，也不打断正在执行的回合。
    const removed = teamMemberStore.remove(member.id)
    if (!removed) throw new Error(`Team member 不存在: ${member.id}`)
    emitTeamUpdate(removed.team_id, 'member.removed')
    sendResult({ ok: true })
  },
  /**
   * 定向发送：用户在团队线里直接把消息发给某成员（绕过 Master 编排）。
   * 复用 teamService.dispatchMessage —— 免费获得 FIFO 排队（成员在跑时返回 'queued'）、
   * 格子自愈（该线成员格子缺失时现场补建）与「你 → 成员」转录署名（senderRole='team-directed'）。
   */
  'team.member.message'(msg, { state, sendResult }) {
    requireOwner(state)
    const member = requireActiveTeamMember(requiredText(msg.memberId, 'memberId'))
    const content = requiredText(msg.content, 'content')
    const sessionId = typeof msg.sessionId === 'string' && msg.sessionId.trim() ? msg.sessionId.trim() : undefined
    const result = teamService.dispatchMessage({
      teamId: member.team_id,
      memberId: member.id,
      content,
      sourceSessionId: sessionId,
      directed: true,
    })
    sendResult({ status: result.status, memberId: member.id, memberName: member.name })
  },
}

/** 生效模型解析顺序：成员独立 → Master 档案 → Agent 原配置 → 系统默认。 */
export function describeTeamMemberModelConfig(member: TeamMemberRow): TeamMemberModelConfig {
  const runtime = memberRuntime(member)
  const modelProfileMode = normalizeModelProfileMode(member.model_profile_mode ?? (member.model_profile_id ? 'fixed' : 'inherit'))
  return {
    modelProfileMode,
    modelProfileId: member.model_profile_id,
    systemPromptOverride: member.system_prompt_override,
    effort: member.reasoning_effort,
    runtime,
    effective: resolveEffectiveModel(member, modelProfileMode, runtime),
    fallback: resolveFallbackModel(member.agent_id, runtime),
    agentSystemPrompt: agentStore.get(member.agent_id)?.system_prompt || null,
    agentModelProfileId: readModelProfileId(agentStore.get(member.agent_id)?.config_json ?? null) || null,
  }
}

function resolveEffectiveModel(member: TeamMemberRow, mode: TeamMemberModelProfileMode, runtime: string): TeamMemberEffectiveModel {
  if (runtime !== 'claude' && runtime !== 'codex') return { name: '系统默认', source: '未指定档案' }
  // 1. 成员独立（固定档案；档案失效则继续向下解析）
  if (mode === 'fixed' && member.model_profile_id) {
    const profile = modelProfileStore.get(member.model_profile_id)
    if (profile && profile.enabled === 1 && profile.runtime === runtime) {
      return { name: profile.name, source: member.role === 'leader' ? 'Master 档案' : '独立配置' }
    }
  }
  // 2. Master 档案（成员继承；Master 自己无上级，跳过）
  if (member.role !== 'leader' && mode !== 'system') {
    const leader = teamMemberStore.list(member.team_id).find((candidate) => candidate.role === 'leader')
    if (leader) {
      const leaderMode = normalizeModelProfileMode(leader.model_profile_mode ?? (leader.model_profile_id ? 'fixed' : 'inherit'))
      if (leaderMode === 'fixed' && leader.model_profile_id) {
        const profile = modelProfileStore.get(leader.model_profile_id)
        if (profile && profile.enabled === 1 && profile.runtime === runtime) return { name: profile.name, source: '继承 Master' }
      }
      if (mode === 'inherit') {
        // Master 未固定档案时按其自身解析链（Agent 原配置 → 系统默认）展示，来源仍标注为继承 Master。
        return { ...resolveFallbackModel(leader.agent_id, runtime), source: '继承 Master' }
      }
    }
  }
  return resolveFallbackModel(member.agent_id, runtime)
}

function resolveFallbackModel(agentId: string, runtime: string): TeamMemberEffectiveModel {
  const agent = agentStore.get(agentId)
  // 3. Agent 原配置（Agent 自身的档案模式/固定档案）
  if (agent) {
    const resolved = resolveAgentModelProfile(runtime, agent)
    if (resolved) return { name: resolved.profile.name, source: 'Agent 配置' }
  }
  // 4. 系统默认（Runtime 全局档案；未启用则为未指定档案）
  const global = getGlobalModelProfile(runtime === 'codex' ? 'codex' : 'claude')
  if (global.enabled && global.profileId) {
    const profile = modelProfileStore.get(global.profileId)
    if (profile && profile.enabled === 1 && profile.runtime === runtime) return { name: profile.name, source: '系统默认' }
  }
  return { name: '系统默认', source: '未指定档案' }
}

function normalizeModelProfileMode(value: unknown): TeamMemberModelProfileMode {
  return value === 'fixed' || value === 'system' || value === 'inherit' ? value : 'inherit'
}

/** 成员级档位白名单：与 UI capabilities 的档位取值同域（claude 的 'default' 哨兵＝跟随模型默认）。 */
const MEMBER_EFFORT_VALUES = new Set(['default', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

function normalizeMemberEffort(value: unknown): string {
  if (typeof value !== 'string' || !MEMBER_EFFORT_VALUES.has(value.trim())) {
    throw new Error('档位取值非法：仅支持 default/minimal/low/medium/high/xhigh/max')
  }
  return value.trim()
}

function memberRuntime(member: TeamMemberRow): string {
  return agentStore.get(member.agent_id)?.runtime ?? 'claude'
}

function assertProfileUsable(profileId: string, runtime: string): void {
  const profile = modelProfileStore.get(profileId)
  if (!profile || profile.enabled !== 1) throw new Error('模型档案不存在或已禁用')
  if (profile.runtime !== runtime) throw new Error('模型档案运行时与成员 Agent 运行时不匹配')
}

function requireTeamMember(memberId: string): TeamMemberRow {
  const member = teamMemberStore.get(memberId)
  if (!member) throw new Error(`Team member 不存在: ${memberId}`)
  return member
}

/** 成员级配置读写仅限 active 成员：已移除成员（status='removed'）拒绝读写。 */
function requireActiveTeamMember(memberId: string): TeamMemberRow {
  const member = requireTeamMember(memberId)
  if (member.status === 'removed') throw new Error('成员已从团队移除，无法读取或修改配置')
  return member
}

function requireOwner(state: { authMode: string }): void {
  if (state.authMode !== 'owner') throw new Error('仅所有者可管理团队成员配置')
}

function emitTeamUpdate(teamId: string, reason: string): void {
  events.emit('team:update', {
    teamId,
    sessionIds: teamMemberStore.list(teamId).map((member) => member.session_id),
    data: { reason },
  })
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field} 不能为空`)
  return value.trim()
}
