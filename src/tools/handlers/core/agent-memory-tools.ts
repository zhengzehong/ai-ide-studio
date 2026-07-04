import { agentMemoryService, AGENT_MEMORY_MAX_PINNED } from '../../../core/agent-memory.js'
import { agentStore } from '../../../store/agents.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../../types.js'

export const defineMemoryDimensionHandler: ToolHandler = {
  name: 'define_memory_dimension',
  description:
    '为当前 Agent 定义一个新的记忆维度。仅当现有维度无法承载某类信息时调用(如发现一类新的偏好/经验需要单独管理)。不要为单条信息建维度,优先 record 到已有维度。',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '维度名,如"协作习惯"。同 Agent 下唯一。' },
      description: { type: 'string', description: '维度用途简述' },
      prompt: { type: 'string', description: '注入 System Prompt 的指令,含何时记录/何时使用/条目结构' },
    },
    required: ['name', 'description', 'prompt'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const { projectId, agentId } = resolveContext(input, context)
    const dim = agentMemoryService.defineDimension({
      projectId,
      agentId,
      name: requireString(input, 'name'),
      description: requireString(input, 'description'),
      prompt: requireString(input, 'prompt'),
    })
    return jsonResult({ dimension_id: dim.id, name: dim.name })
  },
}

export const recallMemoryHandler: ToolHandler = {
  name: 'recall_memory',
  description:
    '从指定维度按关键词查询记忆。按维度 prompt 的"何时使用"规则调用。不确定历史偏好/经验时主动查。返回条目摘要(id/title/preview/tags/use_count),需要完整内容用 get_memory。',
  inputSchema: {
    type: 'object',
    properties: {
      dimension: { type: 'string', description: '维度名称' },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        description: '多关键词,OR 匹配(任一命中即返回)',
      },
      limit: { type: 'number', default: 5 },
    },
    required: ['dimension', 'keywords'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const { projectId, agentId } = resolveContext(input, context)
    const summaries = agentMemoryService.recall({
      projectId,
      agentId,
      dimension: requireString(input, 'dimension'),
      keywords: requireStringArray(input, 'keywords'),
      limit: optionalNumber(input, 'limit'),
    })
    return jsonResult({ entries: summaries })
  },
}

export const listMemoryHandler: ToolHandler = {
  name: 'list_memory',
  description:
    '列出某维度下所有条目摘要。用于概览该维度有什么记忆、不针对具体问题时浏览。返回摘要列表,需完整内容用 get_memory。',
  inputSchema: {
    type: 'object',
    properties: {
      dimension: { type: 'string', description: '维度名称' },
      limit: { type: 'number', default: 50 },
    },
    required: ['dimension'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const { projectId, agentId } = resolveContext(input, context)
    const summaries = agentMemoryService.listEntries(
      projectId,
      agentId,
      requireString(input, 'dimension'),
    )
    return jsonResult({ entries: summaries, pinnedLimit: AGENT_MEMORY_MAX_PINNED })
  },
}

export const getMemoryHandler: ToolHandler = {
  name: 'get_memory',
  description:
    '按 entry_id 获取单条记忆的完整内容(Markdown 全文)。recall_memory / list_memory 返回的摘要不够细时用此工具取全文。',
  inputSchema: {
    type: 'object',
    properties: {
      entry_id: { type: 'string', description: '条目 id' },
    },
    required: ['entry_id'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const { projectId, agentId } = resolveContext(input, context)
    const entry = agentMemoryService.getEntry(projectId, agentId, requireString(input, 'entry_id'))
    return jsonResult({ entry })
  },
}

export const recordMemoryHandler: ToolHandler = {
  name: 'record_memory',
  description:
    '向指定维度记录一条新条目。按维度 prompt 的"何时记录"规则调用。只记高价值、可复用的信息。content 支持 Markdown 格式,长条目(经验方法/事故复盘)用 MD 结构化。',
  inputSchema: {
    type: 'object',
    properties: {
      dimension: { type: 'string', description: '维度名称' },
      title: { type: 'string', description: '一句话标题' },
      content: {
        type: 'string',
        description: '条目正文,支持 Markdown。短条目可纯文本,长条目用 MD 结构化(标题/列表/代码块)',
      },
      tags: { type: 'array', items: { type: 'string' }, description: '标签列表' },
      confidence: { type: 'number', description: '置信度 0-1,默认 1.0' },
    },
    required: ['dimension', 'title', 'content'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const { projectId, agentId } = resolveContext(input, context)
    const entry = agentMemoryService.recordEntry({
      projectId,
      agentId,
      dimension: requireString(input, 'dimension'),
      title: requireString(input, 'title'),
      content: requireString(input, 'content'),
      tags: optionalStringArray(input, 'tags'),
      confidence: optionalNumber(input, 'confidence'),
      sourceSessionId: context.sessionId ?? null,
      sourceTaskId: undefined,
    })
    return jsonResult({ entry })
  },
}

export const updateMemoryHandler: ToolHandler = {
  name: 'update_memory',
  description: '更新已存在条目的 title/content/tags。用于修正或补充记忆。content 支持 Markdown。',
  inputSchema: {
    type: 'object',
    properties: {
      entry_id: { type: 'string', description: '条目 id' },
      title: { type: 'string', description: '新标题' },
      content: { type: 'string', description: '条目正文,支持 Markdown' },
      tags: { type: 'array', items: { type: 'string' }, description: '新标签列表(覆盖)' },
      confidence: { type: 'number', description: '置信度 0-1' },
      pinned: { type: 'boolean', description: '是否置顶(单 Agent 上限 20 条)' },
    },
    required: ['entry_id'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const { projectId, agentId } = resolveContext(input, context)
    const entry = agentMemoryService.updateEntry({
      projectId,
      agentId,
      entryId: requireString(input, 'entry_id'),
      title: optionalString(input, 'title'),
      content: optionalString(input, 'content'),
      tags: optionalStringArray(input, 'tags'),
      confidence: optionalNumber(input, 'confidence'),
      pinned: optionalBoolean(input, 'pinned'),
    })
    return jsonResult({ entry })
  },
}

export const deleteMemoryHandler: ToolHandler = {
  name: 'delete_memory',
  description: '删除一条已无价值的记忆条目(软删除)。',
  inputSchema: {
    type: 'object',
    properties: {
      entry_id: { type: 'string', description: '条目 id' },
    },
    required: ['entry_id'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const { projectId, agentId } = resolveContext(input, context)
    agentMemoryService.deleteEntry({
      projectId,
      agentId,
      entryId: requireString(input, 'entry_id'),
    })
    return jsonResult({ ok: true })
  },
}

export const seedBuiltinMemoryDimensionsHandler: ToolHandler = {
  name: 'agent_memory.seed_builtin',
  description:
    '为指定 Agent 补齐内置记忆维度(lessons/facts/preferences)。已有同名维度会跳过。用于老 Agent 升级到内置维度方案。',
  inputSchema: {
    type: 'object',
    properties: {
      agentId: { type: 'string', description: '目标 Agent ID' },
    },
    required: ['agentId'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const agentId = requireString(input, 'agentId')
    const agent = agentStore.get(agentId)
    if (!agent) throw new Error(`AGENT_NOT_FOUND: ${agentId}`)
    const projectId = context.projectId ?? agent.project_id
    if (!projectId) throw new Error('projectId is required (set in context or agent has no project)')
    const created = agentMemoryService.seedBuiltinDimensions(projectId, agentId)
    return jsonResult({
      ok: true,
      seeded: created.map((d) => ({ id: d.id, name: d.name })),
      seededCount: created.length,
    })
  },
}

function resolveContext(input: ToolHandlerInput, context: ToolContext): { projectId: string; agentId: string } {
  const projectId = context.projectId ?? optionalString(input, 'projectId')
  if (!projectId) throw new Error('projectId is required (set in context or pass explicitly)')
  const agentId = context.agentId
  if (!agentId) throw new Error('agentId is required (set in context)')
  return { projectId, agentId }
}

function requireString(input: ToolHandlerInput, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`)
  return value.trim()
}

function optionalString(input: ToolHandlerInput, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function requireStringArray(input: ToolHandlerInput, key: string): string[] {
  const value = input[key]
  if (!Array.isArray(value)) throw new Error(`${key} must be an array`)
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
}

function optionalStringArray(input: ToolHandlerInput, key: string): string[] | undefined {
  const value = input[key]
  if (!Array.isArray(value)) return undefined
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
}

function optionalNumber(input: ToolHandlerInput, key: string): number | undefined {
  const value = input[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalBoolean(input: ToolHandlerInput, key: string): boolean | undefined {
  const value = input[key]
  return typeof value === 'boolean' ? value : undefined
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}
