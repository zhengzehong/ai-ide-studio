import {
  createProjectSecretary,
  deleteProjectSecretary,
  getProjectSecretary,
  listProjectSecretaries,
  updateProjectSecretary,
  type UpdateProjectSecretaryInput,
} from '../../../core/project-secretary.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../../types.js'

const managementTools = {
  list: tool('studio.secretary.list', '列出当前项目的全部秘书。', emptySchema(), async (_input, context) => (
    listProjectSecretaries(requireProjectId(context))
  )),
  get: tool('studio.secretary.get', '读取当前项目中一个秘书的完整配置。', idSchema(), async (input, context) => (
    getProjectSecretary(requiredText(input.secretaryId, 'secretaryId', 120), requireProjectId(context))
  )),
  create: tool('studio.secretary.create', '在当前项目创建秘书。项目由当前会话自动确定。', createSchema(), async (input, context) => (
    createProjectSecretary({
      projectId: requireProjectId(context),
      name: requiredText(input.name, 'name', 120),
      definitionPrompt: optionalText(input.definitionPrompt, 20_000) ?? '',
      reportPrompt: optionalText(input.reportPrompt, 20_000) ?? '',
      executionAgentId: requiredText(input.executionAgentId, 'executionAgentId', 120),
      observeAll: optionalBoolean(input.observeAll) ?? true,
      observedAgentIds: optionalStringArray(input.observedAgentIds, 'observedAgentIds', 100),
      cron: optionalText(input.cron, 80),
      watchSessionDone: optionalBoolean(input.watchSessionDone) ?? true,
      watchTaskNeedsInput: optionalBoolean(input.watchTaskNeedsInput) ?? false,
    })
  )),
  update: tool('studio.secretary.update', '修改当前项目中的秘书配置。只传需要改变的字段。', updateSchema(), async (input, context) => {
    const secretaryId = requiredText(input.secretaryId, 'secretaryId', 120)
    const update = parseUpdate(input)
    if (Object.keys(update).length === 0) throw new Error('至少提供一个要修改的字段')
    return updateProjectSecretary(secretaryId, requireProjectId(context), update)
  }),
  delete: tool('studio.secretary.delete', '删除当前项目秘书及其隐藏会话和定时规则。必须同时提供当前名称确认。', deleteSchema(), async (input, context) => {
    const projectId = requireProjectId(context)
    const secretaryId = requiredText(input.secretaryId, 'secretaryId', 120)
    const name = requiredText(input.name, 'name', 120)
    const secretary = getProjectSecretary(secretaryId, projectId)
    if (secretary.name !== name) throw new Error('name 与当前秘书名称不匹配，拒绝删除')
    deleteProjectSecretary(secretaryId, projectId)
    return { deleted: true, secretaryId }
  }),
}

export const secretaryListHandler = managementTools.list
export const secretaryGetHandler = managementTools.get
export const secretaryCreateHandler = managementTools.create
export const secretaryUpdateHandler = managementTools.update
export const secretaryDeleteHandler = managementTools.delete

function tool(
  name: string,
  description: string,
  inputSchema: object,
  executeValue: (input: ToolHandlerInput, context: ToolContext) => Promise<unknown> | unknown,
): ToolHandler {
  return {
    name,
    description,
    inputSchema,
    async execute(input, context): Promise<ToolHandlerResult> {
      return jsonResult(await executeValue(input, context))
    },
  }
}

function parseUpdate(input: ToolHandlerInput): UpdateProjectSecretaryInput {
  const update: UpdateProjectSecretaryInput = {}
  if (input.name !== undefined) update.name = requiredText(input.name, 'name', 120)
  if (input.definitionPrompt !== undefined) update.definitionPrompt = optionalText(input.definitionPrompt, 20_000)
  if (input.reportPrompt !== undefined) update.reportPrompt = optionalText(input.reportPrompt, 20_000)
  if (input.executionAgentId !== undefined) update.executionAgentId = requiredText(input.executionAgentId, 'executionAgentId', 120)
  if (input.enabled !== undefined) update.enabled = requiredBoolean(input.enabled, 'enabled')
  if (input.observeAll !== undefined) update.observeAll = requiredBoolean(input.observeAll, 'observeAll')
  if (input.observedAgentIds !== undefined) update.observedAgentIds = optionalStringArray(input.observedAgentIds, 'observedAgentIds', 100)
  if (Object.prototype.hasOwnProperty.call(input, 'cron')) update.cron = optionalText(input.cron, 80) ?? ''
  if (input.watchSessionDone !== undefined) update.watchSessionDone = requiredBoolean(input.watchSessionDone, 'watchSessionDone')
  if (input.watchTaskNeedsInput !== undefined) update.watchTaskNeedsInput = requiredBoolean(input.watchTaskNeedsInput, 'watchTaskNeedsInput')
  return update
}

function requireProjectId(context: ToolContext): string {
  if (!context.projectId) throw new Error('秘书管理工具只能在项目会话中使用')
  return context.projectId
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 不能为空`)
  const text = value.trim()
  if (text.length > maxLength) throw new Error(`${field} 最多 ${maxLength} 个字符`)
  return text
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`文本最多 ${maxLength} 个字符`)
  return value.trim()
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} 必须是布尔值`)
  return value
}

function optionalBoolean(value: unknown): boolean | undefined {
  return value === undefined ? undefined : requiredBoolean(value, '布尔参数')
}

function optionalStringArray(value: unknown, field: string, maxItems: number): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${field} 格式错误`)
  return value.map((item, index) => requiredText(item, `${field}[${index}]`, 120))
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

function emptySchema(): object {
  return { type: 'object', properties: {} }
}

function idSchema(): object {
  return { type: 'object', properties: { secretaryId: { type: 'string', description: '秘书 ID' } }, required: ['secretaryId'] }
}

function createSchema(): object {
  return {
    type: 'object',
    properties: commonProperties(),
    required: ['name', 'executionAgentId'],
  }
}

function updateSchema(): object {
  return {
    type: 'object',
    properties: { secretaryId: { type: 'string', description: '秘书 ID' }, ...commonProperties(), enabled: { type: 'boolean' } },
    required: ['secretaryId'],
  }
}

function deleteSchema(): object {
  return {
    type: 'object',
    properties: {
      secretaryId: { type: 'string', description: '秘书 ID' },
      name: { type: 'string', description: '当前秘书名称，用于确认删除目标' },
    },
    required: ['secretaryId', 'name'],
  }
}

function commonProperties(): Record<string, object> {
  return {
    name: { type: 'string', description: '秘书名称' },
    definitionPrompt: { type: 'string', description: '秘书职责和观察重点' },
    reportPrompt: { type: 'string', description: '汇报内容与格式要求' },
    executionAgentId: { type: 'string', description: '当前项目内负责执行的 Agent ID' },
    observeAll: { type: 'boolean', description: '是否观察当前项目全部 Agent' },
    observedAgentIds: { type: 'array', items: { type: 'string' }, description: 'observeAll=false 时观察的 Agent ID' },
    cron: { type: 'string', description: '可选的 5 段 Cron；空字符串表示清除定时触发' },
    watchSessionDone: { type: 'boolean', description: '是否在观察会话完成时触发' },
    watchTaskNeedsInput: { type: 'boolean', description: '是否在任务需要处理时触发' },
  }
}
