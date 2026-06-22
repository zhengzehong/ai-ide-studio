import { deleteAgentTemplate } from '../../../core/agents.js'
import { templateStore } from '../../../store/agent-templates.js'
import type { ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../../types.js'

export const listAgentTemplatesHandler: ToolHandler = {
  name: 'agent.template.list',
  description: '列出 Agent 广场模板',
  inputSchema: { type: 'object', properties: {} },
  async execute(): Promise<ToolHandlerResult> {
    return jsonResult({ templates: templateStore.list() })
  },
}

export const getAgentTemplateHandler: ToolHandler = {
  name: 'agent.template.get',
  description: '获取 Agent 广场模板详情',
  inputSchema: {
    type: 'object',
    properties: { templateId: { type: 'string', description: '模板 ID' } },
    required: ['templateId'],
  },
  async execute(input: ToolHandlerInput): Promise<ToolHandlerResult> {
    const templateId = requireString(input, 'templateId')
    const template = templateStore.get(templateId)
    if (!template) return errorResult(`Agent 模板不存在: ${templateId}`)
    return jsonResult({ template })
  },
}

export const createAgentTemplateHandler: ToolHandler = {
  name: 'agent.template.create',
  description: '创建 Agent 广场模板。只创建全局模板，不会自动添加到项目或配置事件订阅。',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '模板名称' },
      type: { type: 'string', description: 'Agent 类型' },
      runtime: { type: 'string', enum: ['mock', 'claude', 'codex'], description: '运行时' },
      icon: { type: 'string', description: '图标' },
      description: { type: 'string', description: '模板描述' },
      systemPrompt: { type: 'string', description: '系统提示词' },
      skills: { type: 'array', items: { type: 'string' }, description: '能力标签' },
    },
    required: ['name', 'type'],
  },
  async execute(input: ToolHandlerInput): Promise<ToolHandlerResult> {
    return jsonResult({
      template: templateStore.create({
        name: requireString(input, 'name'),
        type: requireString(input, 'type'),
        runtime: optionalRuntime(input.runtime),
        icon: optionalString(input, 'icon'),
        description: optionalString(input, 'description'),
        systemPrompt: optionalString(input, 'systemPrompt'),
        skills: optionalStringArray(input, 'skills'),
      }),
    })
  },
}

export const updateAgentTemplateHandler: ToolHandler = {
  name: 'agent.template.update',
  description: '更新 Agent 广场模板。字段不传则保持原值。',
  inputSchema: {
    type: 'object',
    properties: {
      templateId: { type: 'string', description: '模板 ID' },
      name: { type: 'string', description: '模板名称' },
      type: { type: 'string', description: 'Agent 类型' },
      runtime: { type: 'string', enum: ['mock', 'claude', 'codex'], description: '运行时' },
      icon: { type: 'string', description: '图标' },
      description: { type: 'string', description: '模板描述' },
      systemPrompt: { type: 'string', description: '系统提示词' },
      skills: { type: 'array', items: { type: 'string' }, description: '能力标签' },
    },
    required: ['templateId'],
  },
  async execute(input: ToolHandlerInput): Promise<ToolHandlerResult> {
    const templateId = requireString(input, 'templateId')
    if (!templateStore.get(templateId)) return errorResult(`Agent 模板不存在: ${templateId}`)
    const template = templateStore.update(templateId, {
      name: optionalNonEmptyString(input, 'name'),
      type: optionalNonEmptyString(input, 'type'),
      runtime: hasOwn(input, 'runtime') ? optionalRuntime(input.runtime) : undefined,
      icon: optionalString(input, 'icon'),
      description: hasOwn(input, 'description') ? optionalString(input, 'description') ?? '' : undefined,
      systemPrompt: optionalString(input, 'systemPrompt'),
      skills: optionalStringArray(input, 'skills'),
    })
    return jsonResult({ template })
  },
}

export const deleteAgentTemplateHandler: ToolHandler = {
  name: 'agent.template.delete',
  description: '删除 Agent 广场自定义模板。内置模板不能删除。',
  inputSchema: {
    type: 'object',
    properties: { templateId: { type: 'string', description: '模板 ID' } },
    required: ['templateId'],
  },
  async execute(input: ToolHandlerInput): Promise<ToolHandlerResult> {
    const templateId = requireString(input, 'templateId')
    deleteAgentTemplate(templateId)
    return jsonResult({ deleted: true, templateId })
  },
}

function requireString(input: ToolHandlerInput, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} 不能为空`)
  return value.trim()
}

function optionalString(input: ToolHandlerInput, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' ? value : undefined
}

function optionalNonEmptyString(input: ToolHandlerInput, key: string): string | undefined {
  if (!hasOwn(input, key)) return undefined
  return requireString(input, key)
}

function optionalRuntime(value: unknown): 'mock' | 'claude' | 'codex' | undefined {
  if (value === undefined) return undefined
  if (value === 'mock' || value === 'claude' || value === 'codex') return value
  throw new Error('runtime 必须是 mock、claude 或 codex')
}

function optionalStringArray(input: ToolHandlerInput, key: string): string[] | undefined {
  if (!hasOwn(input, key)) return undefined
  const value = input[key]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${key} 必须是字符串数组`)
  }
  return value
}

function hasOwn(input: ToolHandlerInput, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorResult(message: string): ToolHandlerResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}
