import { templateStore } from '../store/agent-templates.js'
import { agentStore, type AgentRow } from '../store/agents.js'
import { modelProfileStore } from '../store/model-profiles.js'
import { createCustomProjectAgent, deployTemplateToProject } from './agents.js'

export interface TeamMemberSpawnInput {
  templateId?: string
  agentId?: string
  name?: string
  type?: string
  runtime?: string
  systemPrompt?: string
  icon?: string
  modelProfileId?: string
}

export function resolveSpawnAgent(projectId: string, input: TeamMemberSpawnInput): AgentRow {
  if (input.agentId) return requireAgent(input.agentId)
  if (input.templateId) {
    return deployTemplateToProject(input.templateId, projectId, {
      name: input.name,
      runtime: input.runtime,
      systemPrompt: input.systemPrompt,
      icon: input.icon,
    })
  }
  return createCustomProjectAgent({
    projectId,
    name: required(input.name, 'name'),
    type: required(input.type, 'type'),
    runtime: required(input.runtime, 'runtime'),
    systemPrompt: input.systemPrompt,
    icon: input.icon,
  })
}

export function resolveSpawnRuntime(input: TeamMemberSpawnInput): string {
  if (input.agentId) return requireAgent(input.agentId).runtime
  if (input.templateId) {
    const template = templateStore.get(input.templateId)
    if (!template) throw new Error(`Agent 模板不存在: ${input.templateId}`)
    return input.runtime || template.runtime
  }
  return required(input.runtime, 'runtime')
}

export function ensureTeamMemberModelProfile(modelProfileId: string | undefined, runtime: string): void {
  if (!modelProfileId?.trim()) return
  const profile = modelProfileStore.get(modelProfileId.trim())
  if (!profile) throw new Error(`模型档案不存在: ${modelProfileId}`)
  if (profile.runtime !== runtime) throw new Error('模型档案运行时与成员 Agent 运行时不匹配')
}

function requireAgent(agentId: string): AgentRow {
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`Agent 不存在: ${agentId}`)
  return agent
}

function required(value: string | undefined, key: string): string {
  if (!value?.trim()) throw new Error(`${key} 不能为空`)
  return value
}
