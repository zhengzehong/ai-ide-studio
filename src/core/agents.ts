import { createChildLogger } from './logger.js'
import { agentStore, type AgentRow } from '../store/agents.js'
import { templateStore } from '../store/agent-templates.js'
import { projectStore } from '../store/projects.js'

const log = createChildLogger('agents')

export interface DeployTemplateInput {
  name?: string
}

export function deployTemplateToProject(templateId: string, projectId: string, input: DeployTemplateInput = {}): AgentRow {
  const project = projectStore.get(projectId)
  if (!project) throw new Error(`项目不存在: ${projectId}`)

  const template = templateStore.get(templateId)
  if (!template) throw new Error(`Agent 模板不存在: ${templateId}`)

  const agent = agentStore.create({
    name: input.name?.trim() || template.name,
    type: template.type,
    runtime: template.runtime,
    projectId,
    templateId,
    systemPrompt: template.system_prompt,
    icon: template.icon,
    config: {
      templateId,
      skills: template.skills_json ? JSON.parse(template.skills_json) : [],
    },
  })

  log.info({ agentId: agent.id, templateId, projectId }, 'Agent 模板已部署到项目')
  return agent
}

export function deleteAgentTemplate(templateId: string): void {
  const template = templateStore.get(templateId)
  if (!template) return
  if (template.is_builtin) throw new Error('内置模板不能删除')
  templateStore.delete(templateId)
}
