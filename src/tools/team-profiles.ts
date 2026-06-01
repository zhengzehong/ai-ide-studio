import { agentStore } from '../store/agents.js'
import { toolBindingStore, toolStore } from '../store/tools.js'

export type ToolProfileId = 'team-readonly' | 'team-member' | 'team-leader'

export interface ToolProfile {
  id: ToolProfileId
  name: string
  description: string
  toolNames: string[]
}

export interface ApplyToolProfileInput {
  profileId: ToolProfileId
  agentId: string
}

export interface ApplyToolProfileResult {
  profile: ToolProfile
  agentId: string
  boundToolNames: string[]
  missingToolNames: string[]
}

const TEAM_READONLY_TOOLS = ['team.list', 'team.get', 'team.member.list', 'team.task.list', 'team.mailbox.list']

const TEAM_MEMBER_TOOLS = [...TEAM_READONLY_TOOLS, 'team.mailbox.send', 'team.task.update']

const TEAM_LEADER_TOOLS = [
  ...TEAM_MEMBER_TOOLS,
  'team.create',
  'team.update',
  'team.member.spawn',
  'team.member.message',
  'team.task.create',
  'team.template.list',
  'team.template.describe',
]

export const TEAM_LEADER_INITIAL_HIDDEN_TOOLS = ['team.mailbox.list', 'team.task.list', 'core.session.get'] as const

export const TOOL_PROFILES: ToolProfile[] = [
  {
    id: 'team-readonly',
    name: 'Team 只读观察者',
    description: '只能查看团队、成员、任务和留言。',
    toolNames: TEAM_READONLY_TOOLS,
  },
  {
    id: 'team-member',
    name: 'Team 协作成员',
    description: '可查看团队，并发送留言、更新自己的团队任务状态。',
    toolNames: TEAM_MEMBER_TOOLS,
  },
  {
    id: 'team-leader',
    name: 'Team 编排者',
    description: '可创建团队、添加成员、派活、创建和更新团队任务。',
    toolNames: TEAM_LEADER_TOOLS,
  },
]

const TEAM_TOOL_PREFIX = 'team.'

export function listToolProfiles(): ToolProfile[] {
  return TOOL_PROFILES.map((profile) => ({ ...profile, toolNames: [...profile.toolNames] }))
}

export function getToolProfile(profileId: string): ToolProfile | undefined {
  const profile = TOOL_PROFILES.find((item) => item.id === profileId)
  return profile ? { ...profile, toolNames: [...profile.toolNames] } : undefined
}

export function applyToolProfileToAgent(input: ApplyToolProfileInput): ApplyToolProfileResult {
  if (!agentStore.get(input.agentId)) throw new Error(`Agent 不存在: ${input.agentId}`)
  const profile = getToolProfile(input.profileId)
  if (!profile) throw new Error(`工具 Profile 不存在: ${input.profileId}`)

  const teamTools = toolStore.list().filter((tool) => tool.name.startsWith(TEAM_TOOL_PREFIX))
  const selected = new Set(profile.toolNames)
  const boundToolNames: string[] = []
  const missingToolNames = profile.toolNames.filter((name) => !teamTools.some((tool) => tool.name === name))

  for (const tool of teamTools) {
    const enabled = selected.has(tool.name)
    toolBindingStore.setEnabled(tool.id, 'agent', input.agentId, enabled)
    if (enabled) boundToolNames.push(tool.name)
  }

  return {
    profile,
    agentId: input.agentId,
    boundToolNames: profile.toolNames.filter((name) => boundToolNames.includes(name)),
    missingToolNames,
  }
}
