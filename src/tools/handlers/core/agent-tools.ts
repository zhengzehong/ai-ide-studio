import { agentStore } from '../../../store/agents.js'
import { createCustomProjectAgent, deployTemplateToProject } from '../../../core/agents.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../../types.js'

export const listAgentsHandler: ToolHandler = {
  name: 'core.agent.list',
  description: '列出 Agent',
  inputSchema: { type: 'object', properties: { projectId: { type: 'string' } } },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const projectId = context.projectId ?? optionalString(input, 'projectId')
    return jsonResult({ agents: agentStore.list(projectId) })
  },
}

export const getAgentHandler: ToolHandler = {
  name: 'core.agent.get',
  description: '获取 Agent 详情',
  inputSchema: { type: 'object', properties: { agentId: { type: 'string' } }, required: ['agentId'] },
  async execute(input: ToolHandlerInput): Promise<ToolHandlerResult> {
    const agentId = requireString(input, 'agentId')
    const agent = agentStore.get(agentId)
    if (!agent) return errorResult(`Agent 不存在: ${agentId}`)
    return jsonResult({ agent })
  },
}

export const createAgentHandler: ToolHandler = {
  name: 'core.agent.create',
  description: '创建项目 Agent',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      templateId: { type: 'string' },
      name: { type: 'string' },
      type: { type: 'string' },
      runtime: { type: 'string' },
      systemPrompt: { type: 'string' },
      icon: { type: 'string' },
      modelProfileId: { type: 'string' },
    },
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const projectId = resolveProjectId(input, context)
    const templateId = optionalString(input, 'templateId')
    const name = optionalString(input, 'name')
    const runtime = optionalString(input, 'runtime')
    const systemPrompt = optionalString(input, 'systemPrompt')
    const icon = optionalString(input, 'icon')
    const modelProfileId = optionalString(input, 'modelProfileId')

    const agent = templateId
      ? deployTemplateToProject(templateId, projectId, { name, runtime, systemPrompt, icon, modelProfileId })
      : createCustomProjectAgent({
          projectId,
          name: requireString(input, 'name'),
          type: requireString(input, 'type'),
          runtime: requireString(input, 'runtime'),
          systemPrompt,
          icon,
          modelProfileId,
        })

    return jsonResult({ agent })
  },
}

function resolveProjectId(input: ToolHandlerInput, context: ToolContext): string {
  const projectId = context.projectId ?? optionalString(input, 'projectId')
  if (!projectId) throw new Error('projectId 不能为空')
  return projectId
}

function requireString(input: ToolHandlerInput, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} 不能为空`)
  return value
}

function optionalString(input: ToolHandlerInput, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' ? value : undefined
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorResult(message: string): ToolHandlerResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}
