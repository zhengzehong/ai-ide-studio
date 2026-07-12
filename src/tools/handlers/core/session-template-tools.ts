import { sessionTemplateStore } from '../../../store/session-templates.js'
import { sessionTemplateManager } from '../../../core/session-templates.js'
import type { ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../../types.js'

export const listSessionTemplatesHandler: ToolHandler = {
  name: 'core.session.template.list',
  description: '列出会话模板(可按 agentId 过滤)。',
  inputSchema: {
    type: 'object',
    properties: {
      agentId: { type: 'string', description: '按 Agent 过滤,不传则返回全部' },
    },
  },
  async execute(input: ToolHandlerInput): Promise<ToolHandlerResult> {
    const agentId = optionalString(input, 'agentId')
    const templates = sessionTemplateStore.list(agentId ? { agentId } : undefined)
    return jsonResult({ templates })
  },
}

export const publishSessionTemplateHandler: ToolHandler = {
  name: 'core.session.template.publish',
  description:
    '把当前会话发布为会话模板。模板是完整对话镜像(ACP fork),不是 system prompt,新建时整个上下文都会被复制。',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: '源会话 ID' },
      name: { type: 'string', description: '模板名称' },
      description: { type: 'string', description: '模板描述(可选)' },
      icon: { type: 'string', description: '模板图标(可选)' },
    },
    required: ['sessionId', 'name'],
  },
  async execute(input: ToolHandlerInput): Promise<ToolHandlerResult> {
    const sessionId = requireString(input, 'sessionId')
    const name = requireString(input, 'name')
    const description = optionalString(input, 'description')
    const icon = optionalString(input, 'icon')
    const template = await sessionTemplateManager.publishSessionAsTemplate({
      sourceSessionId: sessionId,
      name,
      description,
      icon,
    })
    return jsonResult({ template })
  },
}

export const instantiateSessionTemplateHandler: ToolHandler = {
  name: 'core.session.template.instantiate',
  description:
    '从模板新建会话。新会话继承模板的完整对话上下文(ACP fork),不是只复制 system prompt。',
  inputSchema: {
    type: 'object',
    properties: {
      templateId: { type: 'string', description: '会话模板 ID' },
    },
    required: ['templateId'],
  },
  async execute(input: ToolHandlerInput): Promise<ToolHandlerResult> {
    const templateId = requireString(input, 'templateId')
    const session = await sessionTemplateManager.instantiateSessionTemplate(templateId)
    return jsonResult({ session })
  },
}

export const deleteSessionTemplateHandler: ToolHandler = {
  name: 'core.session.template.delete',
  description: '删除会话模板。模板不存在时静默成功。',
  inputSchema: {
    type: 'object',
    properties: {
      templateId: { type: 'string', description: '会话模板 ID' },
    },
    required: ['templateId'],
  },
  async execute(input: ToolHandlerInput): Promise<ToolHandlerResult> {
    const templateId = requireString(input, 'templateId')
    await sessionTemplateManager.deleteTemplate(templateId)
    return jsonResult({ success: true })
  },
}

function requireString(input: ToolHandlerInput, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} 不能为空`)
  return value.trim()
}

function optionalString(input: ToolHandlerInput, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}
