import { buildAgentRuntimeEnv, buildAgentSessionMeta, resolveAgentModelProfile } from '../../acp/model-profile-env.js'
import { buildRuntimeEnv, getRuntimeCommand } from '../../acp/runtime-registry.js'
import { buildAgentAutonomySystemPrompt } from '../../core/agent-autonomy-prompt.js'
import { buildProjectSecretarySystemPrompt } from '../../core/project-secretary-prompt.js'
import type { RuntimeStateSnapshot } from '../../ports/runtime-port.js'
import { agentStore } from '../../store/agents.js'
import { modelProfileStore } from '../../store/model-profiles.js'
import { projectStore } from '../../store/projects.js'
import { messageStore, sessionStore } from '../../store/sessions.js'
import { teamMemberStore } from '../../store/teams.js'
import { resolveToolsAsMcpServers } from '../../tools/resolver.js'
import { resolveVisiblePlatformTools } from '../../tools/registry/visibility-resolver.js'
import { getRuntimePlatformToolTransport } from '../runtime-port-provider.js'

const AUTO_APPROVED_TEAM_TOOLS = new Set(['team.mailbox.send', 'team.task.update'])

export interface BuildRuntimeStateSnapshotInput {
  sessionId: string
  projectId?: string
  cwd?: string
  emitHttpMcp?: boolean
  httpMcpBaseUrl?: string
}

export function buildRuntimeStateSnapshot(input: BuildRuntimeStateSnapshotInput): RuntimeStateSnapshot {
  const platformToolTransport = getRuntimePlatformToolTransport()
  const session = sessionStore.get(input.sessionId)
  if (!session) throw new Error(`Session not found: ${input.sessionId}`)

  const agent = agentStore.get(session.agent_id)
  if (!agent) throw new Error(`Agent not found: ${session.agent_id}`)
  if (session.project_id && agent.project_id && session.project_id !== agent.project_id) {
    throw new Error(`Session and Agent project mismatch: ${session.id}`)
  }

  const persistedProjectId = session.project_id ?? agent.project_id
  if (input.projectId && persistedProjectId && input.projectId !== persistedProjectId) {
    throw new Error(`Runtime context project mismatch: ${session.id}`)
  }
  const projectId = input.projectId ?? persistedProjectId
  const project = projectId ? projectStore.get(projectId) : undefined
  if (projectId && !project) throw new Error(`Project not found: ${projectId}`)

  const teamMember = teamMemberStore.getBySession(session.id)
  const inheritedProfileId = teamMember
    ? resolveTeamInheritedProfileId(teamMember, agent.runtime)
    : undefined
  // 团队成员系统提示词覆盖：仅本团队生效（替换成员 Agent 人设段，平台/团队/记忆提示不受影响），留空则用 Agent 原提示词。
  const effectiveAgent = teamMember?.system_prompt_override?.trim()
    ? { ...agent, system_prompt: teamMember.system_prompt_override }
    : agent
  const runtimeEnv = agent.runtime === 'mock'
    ? { env: buildRuntimeEnv(agent.runtime), appliedProfile: undefined }
    : buildAgentRuntimeEnv(agent.runtime, agent, process.env, {
      ...(inheritedProfileId ? { modelProfileIdOverride: inheritedProfileId } : {}),
      // 成员级默认档位（team_members.reasoning_effort，NULL=跟随档案）：随 appliedProfile.effort 经
      // applyConfigPreferences 既有通道下发为会话默认；会话里手切过的档位优先。
      ...(teamMember?.reasoning_effort ? { effortOverride: teamMember.reasoning_effort } : {}),
    })
  const sessionMeta = buildAgentSessionMeta(agent.runtime, runtimeEnv.env, effectiveAgent, {
    sessionId: session.id,
    isPrimary: session.is_primary === 1,
    additionalPrompt: session.purpose === 'autonomy'
      ? buildAgentAutonomySystemPrompt(agent.id)
      : session.purpose === 'secretary_runtime' || session.purpose === 'secretary_chat'
        ? buildProjectSecretarySystemPrompt(session.id)
        : undefined,
  })
  const visibleTools = teamMember
    ? resolveVisiblePlatformTools({ agentId: agent.id, projectId: projectId ?? undefined, sessionId: session.id })
    : []

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      runtime: agent.runtime,
      permissionLevel: agent.permission_level,
      config: parseObject(agent.config_json),
      systemPrompt: agent.system_prompt,
      projectId: agent.project_id,
    },
    session: {
      id: session.id,
      agentId: session.agent_id,
      taskId: session.task_id,
      projectId,
      cwd: input.cwd ?? (project?.work_dir || process.cwd()),
      title: session.title,
      acpSessionId: session.acp_session_id,
      canRecreateMissingSession: !messageStore.hasMaterializedAgentHistory(session.id, {
        runtime: agent.runtime,
        sessionId: session.acp_session_id,
      }),
      isPrimary: session.is_primary === 1,
      purpose: session.purpose,
    },
    runtime: {
      command: getRuntimeCommand(agent.runtime),
      env: cloneEnvironment(runtimeEnv.env),
      sessionMeta,
      gatewayAuth: runtimeEnv.gatewayAuth,
      appliedModelProfile: runtimeEnv.appliedProfile,
      captureBinding: runtimeEnv.captureBinding,
    },
    runtimePreferences: sessionStore.getRuntimePreferences(session.id),
    mcpServers: resolveToolsAsMcpServers({
      agentId: agent.id,
      projectId: projectId ?? undefined,
      sessionId: session.id,
      teamId: teamMember?.team_id,
      teamMemberId: teamMember?.id,
      preferHttp: input.emitHttpMcp ?? platformToolTransport?.type === 'http',
      baseUrl: input.httpMcpBaseUrl ?? platformToolTransport?.baseUrl,
    }),
    team: teamMember
      ? { teamId: teamMember.team_id, memberId: teamMember.id, role: teamMember.role }
      : undefined,
    autoApprovedToolNames: visibleTools
      .filter((tool) => AUTO_APPROVED_TEAM_TOOLS.has(tool.definition.name) && !tool.definition.permissions.requiresApproval)
      .map((tool) => tool.definition.name),
  }
}

/**
 * 团队成员生效模型档案解析（执行层）。与 RPC `describeTeamMemberModelConfig` 的展示解析保持同一条链，展示即所得：
 * - fixed：成员固定档案（档案被禁用/删除/运行时不匹配则继续向下回退）；
 * - inherit：成员继承 Master —— Master 固定档案优先，否则按 Master 自身解析链（Agent 原配置 → 系统默认）；
 * - system：成员固定档案与 Master 档案都不生效，按成员 Agent 原配置 → 系统默认（即返回 undefined 不覆盖）。
 * 返回 undefined 表示不覆盖，由 buildAgentRuntimeEnv 按成员 Agent 自身配置解析。
 */
export function resolveTeamInheritedProfileId(
  member: NonNullable<ReturnType<typeof teamMemberStore.getBySession>>,
  runtime: string,
): string | undefined {
  if (runtime !== 'claude' && runtime !== 'codex') return undefined
  const mode = normalizeMemberProfileMode(member)
  if (mode === 'fixed' && member.model_profile_id?.trim()) {
    const profile = modelProfileStore.get(member.model_profile_id.trim())
    if (profile && profile.enabled === 1 && profile.runtime === runtime) return profile.id
  }
  if (mode === 'system' || member.role === 'leader') return undefined

  const leaderMember = teamMemberStore.list(member.team_id).find((candidate) => candidate.role === 'leader')
  if (!leaderMember) return undefined
  if (normalizeMemberProfileMode(leaderMember) === 'fixed' && leaderMember.model_profile_id?.trim()) {
    const profile = modelProfileStore.get(leaderMember.model_profile_id.trim())
    if (profile && profile.enabled === 1 && profile.runtime === runtime) return profile.id
  }
  if (mode !== 'inherit') return undefined
  const leaderAgent = agentStore.get(leaderMember.agent_id)
  if (!leaderAgent || leaderAgent.runtime !== runtime) return undefined
  return resolveAgentModelProfile(runtime, leaderAgent)?.profile.id
}

/** 与展示层同规则的模式归一：显式 mode 优先；遗留行（migration 067 时代只有 model_profile_id）视为 fixed。 */
function normalizeMemberProfileMode(member: { model_profile_mode: string | null; model_profile_id: string | null }): 'inherit' | 'fixed' | 'system' {
  if (member.model_profile_mode === 'fixed' || member.model_profile_mode === 'system' || member.model_profile_mode === 'inherit') {
    return member.model_profile_mode
  }
  return member.model_profile_id ? 'fixed' : 'inherit'
}

function cloneEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function parseObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}
