import { buildAgentRuntimeEnv, buildAgentSessionMeta } from '../../acp/model-profile-env.js'
import { buildRuntimeEnv, getRuntimeCommand } from '../../acp/runtime-registry.js'
import { buildAgentAutonomySystemPrompt } from '../../core/agent-autonomy-prompt.js'
import { buildProjectSecretarySystemPrompt } from '../../core/project-secretary-prompt.js'
import type { RuntimeStateSnapshot } from '../../ports/runtime-port.js'
import { agentStore } from '../../store/agents.js'
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

  const runtimeEnv = agent.runtime === 'mock'
    ? { env: buildRuntimeEnv(agent.runtime), appliedProfile: undefined }
    : buildAgentRuntimeEnv(agent.runtime, agent)
  const sessionMeta = buildAgentSessionMeta(agent.runtime, runtimeEnv.env, agent, {
    isPrimary: session.is_primary === 1,
    additionalPrompt: session.purpose === 'autonomy'
      ? buildAgentAutonomySystemPrompt(agent.id)
      : session.purpose === 'secretary_runtime' || session.purpose === 'secretary_chat'
        ? buildProjectSecretarySystemPrompt(session.id)
        : undefined,
  })
  const teamMember = teamMemberStore.getBySession(session.id)
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
