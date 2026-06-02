import { createChildLogger } from './logger.js'
import { agentStore, type AgentRow, type UpdateAgentInput } from '../store/agents.js'
import { templateStore } from '../store/agent-templates.js'
import { projectStore } from '../store/projects.js'
import { isSupportedAgentRuntime, SUPPORTED_AGENT_RUNTIMES } from '../acp/adapters.js'
import { applyToolProfileToAgent } from '../tools/team-profiles.js'
import { modelProfileStore } from '../store/model-profiles.js'

const log = createChildLogger('agents')

export interface DeployTemplateInput {
  name?: string
  runtime?: string
  systemPrompt?: string
  icon?: string
  modelProfileId?: string
}

export interface CreateCustomAgentInput {
  projectId: string
  name: string
  type: string
  runtime: string
  systemPrompt?: string
  icon?: string
  modelProfileId?: string
}

export interface UpdateProjectAgentInput {
  name?: string
  type?: string
  runtime?: string
  systemPrompt?: string
  icon?: string
  modelProfileId?: string | null
}

export function deployTemplateToProject(templateId: string, projectId: string, input: DeployTemplateInput = {}): AgentRow {
  const project = projectStore.get(projectId)
  if (!project) throw new Error(`项目不存在: ${projectId}`)

  const template = templateStore.get(templateId)
  if (!template) throw new Error(`Agent 模板不存在: ${templateId}`)
  const runtime = input.runtime || template.runtime
  ensureModelProfileMatches(input.modelProfileId, runtime)

  const agent = agentStore.create({
    name: input.name?.trim() || template.name,
    type: template.type,
    runtime,
    projectId,
    templateId,
    systemPrompt: input.systemPrompt ?? template.system_prompt,
    icon: input.icon || template.icon,
    config: {
      templateId,
      skills: template.skills_json ? JSON.parse(template.skills_json) : [],
      ...(input.modelProfileId ? { modelProfileId: input.modelProfileId } : {}),
    },
  })

  if (template.type === 'leader') {
    applyToolProfileToAgent({ profileId: 'team-leader', agentId: agent.id })
  }

  log.info({ agentId: agent.id, templateId, projectId }, 'Agent 模板已部署到项目')
  return agent
}

export function deleteAgentTemplate(templateId: string): void {
  const template = templateStore.get(templateId)
  if (!template) return
  if (template.is_builtin) throw new Error('内置模板不能删除')
  templateStore.delete(templateId)
}


export function createCustomProjectAgent(input: CreateCustomAgentInput): AgentRow {
  ensureProject(input.projectId)
  const name = input.name.trim()
  if (!name) throw new Error('Agent 名称不能为空')
  if (!isSupportedAgentRuntime(input.runtime)) {
    throw new Error(`不支持的 Agent runtime: ${input.runtime || '空'}。当前仅支持 ${SUPPORTED_AGENT_RUNTIMES.join('|')}`)
  }
  ensureModelProfileMatches(input.modelProfileId, input.runtime)

  const agent = agentStore.create({
    name,
    type: input.type,
    runtime: input.runtime,
    projectId: input.projectId,
    systemPrompt: input.systemPrompt,
    icon: input.icon,
    config: input.modelProfileId ? { modelProfileId: input.modelProfileId } : undefined,
  })
  log.info({ agentId: agent.id, projectId: input.projectId }, '项目自定义 Agent 已创建')
  return agent
}

export function updateProjectAgent(agentId: string, input: UpdateProjectAgentInput): AgentRow {
  const existing = agentStore.get(agentId)
  if (!existing) throw new Error(`Agent 不存在: ${agentId}`)
  if (!existing.project_id) throw new Error('只能操作项目级 Agent')
  if (input.runtime !== undefined && !isSupportedAgentRuntime(input.runtime)) {
    throw new Error(`不支持的 Agent runtime: ${input.runtime || '空'}。当前仅支持 ${SUPPORTED_AGENT_RUNTIMES.join('|')}`)
  }
  const nextRuntime = input.runtime ?? existing.runtime
  if (input.modelProfileId !== undefined && input.modelProfileId !== null) {
    ensureModelProfileMatches(input.modelProfileId, nextRuntime)
  }

  const fields: UpdateAgentInput = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new Error('Agent 名称不能为空')
    fields.name = name
  }
  if (input.type !== undefined) fields.type = input.type
  if (input.runtime !== undefined) fields.runtime = input.runtime
  if (input.systemPrompt !== undefined) fields.systemPrompt = input.systemPrompt
  if (input.icon !== undefined) fields.icon = input.icon
  const config = parseAgentConfig(existing.config_json)
  if (input.modelProfileId !== undefined) {
    if (input.modelProfileId) config.modelProfileId = input.modelProfileId
    else delete config.modelProfileId
    fields.config = config
  } else if (input.runtime !== undefined && hasMismatchedModelProfile(config.modelProfileId, nextRuntime)) {
    delete config.modelProfileId
    fields.config = config
  }

  const updated = agentStore.update(agentId, fields)
  if (!updated) throw new Error(`Agent 不存在: ${agentId}`)
  log.info({ agentId, projectId: existing.project_id }, '项目 Agent 已更新')
  return updated
}

export function deleteProjectAgent(agentId: string): void {
  const existing = agentStore.get(agentId)
  if (!existing) throw new Error(`Agent 不存在: ${agentId}`)
  if (!existing.project_id) throw new Error('只能操作项目级 Agent')
  agentStore.delete(agentId)
  log.info({ agentId, projectId: existing.project_id }, '项目 Agent 已删除')
}

function ensureProject(projectId: string): void {
  if (!projectId) throw new Error('projectId 不能为空')
  const project = projectStore.get(projectId)
  if (!project) throw new Error(`项目不存在: ${projectId}`)
}

function ensureModelProfileMatches(modelProfileId: string | undefined, runtime: string): void {
  if (!modelProfileId) return
  const profile = modelProfileStore.get(modelProfileId)
  if (!profile) throw new Error(`模型档案不存在: ${modelProfileId}`)
  if (profile.runtime !== runtime) throw new Error('模型档案运行时与 Agent 运行时不匹配')
}

function hasMismatchedModelProfile(modelProfileId: unknown, runtime: string): boolean {
  if (typeof modelProfileId !== 'string' || !modelProfileId) return false
  const profile = modelProfileStore.get(modelProfileId)
  return !profile || profile.runtime !== runtime
}

function parseAgentConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
