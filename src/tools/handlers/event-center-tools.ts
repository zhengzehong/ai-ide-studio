import { eventCenterService } from '../../core/event-center.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'

function requireStr(input: ToolHandlerInput, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`参数 ${key} 不能为空`)
  return value.trim()
}

function optStr(input: ToolHandlerInput, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function hasOwn(input: ToolHandlerInput, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

function optionalStringArray(input: ToolHandlerInput, key: string): string[] | undefined {
  if (!hasOwn(input, key)) return undefined
  const value = input[key]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Parameter ${key} must be an array of strings`)
  }
  return value
}

function json(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function projectId(input: ToolHandlerInput, context: ToolContext): string | undefined {
  return context.projectId ?? optStr(input, 'projectId')
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    return record(JSON.parse(value) as unknown)
  } catch {
    return {}
  }
}

function parseStringArray(value: string): string[] {
  try {
    return stringArray(JSON.parse(value) as unknown)
  } catch {
    return []
  }
}

export const eventCategoryListHandler: ToolHandler = {
  name: 'event.category.list',
  description: '列出当前 Agent 可见的事件类别及 payload schema 提示。',
  inputSchema: { type: 'object', properties: {} },
  async execute(_input, context) {
    return json({ categories: eventCenterService.listCategories(context.projectId).filter((category) => category.enabled === 1) })
  },
}

export const eventCategoryCreateHandler: ToolHandler = {
  name: 'event.category.create',
  description: 'Create a new event center category. Fails if the category already exists.',
  inputSchema: {
    type: 'object',
    properties: {
      categoryId: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      schema: { type: 'object' },
      defaultPriority: { type: 'string' },
      allowedWriters: { type: 'array', items: { type: 'string' } },
      allowedConsumers: { type: 'array', items: { type: 'string' } },
      enabled: { type: 'boolean' },
    },
    required: ['categoryId', 'name'],
  },
  async execute(input, context) {
    const categoryId = requireStr(input, 'categoryId')
    if (eventCenterService.getCategory(categoryId, context.projectId)) {
      throw new Error(`Event category already exists: ${categoryId}`)
    }

    return json({
      category: eventCenterService.upsertCategory({
        id: categoryId,
        projectId: context.projectId,
        name: requireStr(input, 'name'),
        description: hasOwn(input, 'description') ? optStr(input, 'description') ?? null : undefined,
        schema: record(input.schema),
        defaultPriority: optStr(input, 'defaultPriority'),
        allowedWriters: optionalStringArray(input, 'allowedWriters'),
        allowedConsumers: optionalStringArray(input, 'allowedConsumers'),
        enabled: typeof input.enabled === 'boolean' ? input.enabled : undefined,
      }),
    })
  },
}

export const eventCategoryUpdateHandler: ToolHandler = {
  name: 'event.category.update',
  description: 'Partially update an existing event center category. Fields not provided are preserved.',
  inputSchema: {
    type: 'object',
    properties: {
      categoryId: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      schema: { type: 'object' },
      defaultPriority: { type: 'string' },
      allowedWriters: { type: 'array', items: { type: 'string' } },
      allowedConsumers: { type: 'array', items: { type: 'string' } },
      enabled: { type: 'boolean' },
    },
    required: ['categoryId'],
  },
  async execute(input, context) {
    const categoryId = requireStr(input, 'categoryId')
    const existing = eventCenterService.getCategory(categoryId, context.projectId)
    if (!existing) throw new Error(`Event category does not exist: ${categoryId}`)

    return json({
      category: eventCenterService.upsertCategory({
        id: categoryId,
        projectId: context.projectId,
        name: optStr(input, 'name') ?? existing.name,
        description: hasOwn(input, 'description') ? optStr(input, 'description') ?? null : existing.description,
        schema: hasOwn(input, 'schema') ? record(input.schema) : parseRecord(existing.schema_json),
        defaultPriority: optStr(input, 'defaultPriority') ?? existing.default_priority,
        allowedWriters: optionalStringArray(input, 'allowedWriters') ?? parseStringArray(existing.allowed_writers_json),
        allowedConsumers: optionalStringArray(input, 'allowedConsumers') ?? parseStringArray(existing.allowed_consumers_json),
        enabled: typeof input.enabled === 'boolean' ? input.enabled : existing.enabled === 1,
      }),
    })
  },
}

export const eventCreateHandler: ToolHandler = {
  name: 'event.create',
  description: '写入事件中心事件。只能写入已启用类别，payload 按类别语义填写。payload 字段可在类别 schema 配 default，不传则用默认值；required 字段必须传或配 default，缺失会抛错。',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '项目 ID；不传使用当前会话项目' },
      categoryId: { type: 'string', description: '事件类别 key' },
      title: { type: 'string', description: '事件标题' },
      summary: { type: 'string', description: '事件摘要' },
      priority: { type: 'string', description: 'low/medium/high' },
      confidence: { type: 'number', description: '0-1 置信度' },
      tags: { type: 'array', items: { type: 'string' } },
      payload: { type: 'object', description: '类别动态字段' },
      evidence: { type: 'array', items: { type: 'object' } },
      dedupeKey: { type: 'string', description: '去重 key' },
    },
    required: ['categoryId', 'title'],
  },
  async execute(input, context) {
    const event = eventCenterService.createEvent({
      projectId: projectId(input, context),
      categoryId: requireStr(input, 'categoryId'),
      title: requireStr(input, 'title'),
      summary: optStr(input, 'summary'),
      sourceType: 'agent',
      sourceId: context.agentId,
      sourceLabel: context.agentId,
      priority: optStr(input, 'priority'),
      confidence: typeof input.confidence === 'number' ? input.confidence : undefined,
      tags: stringArray(input.tags),
      payload: record(input.payload),
      evidence: Array.isArray(input.evidence) ? input.evidence as never : undefined,
      dedupeKey: optStr(input, 'dedupeKey'),
      createdByAgentId: context.agentId,
    })
    return json({ event })
  },
}

export const eventListHandler: ToolHandler = {
  name: 'event.list',
  description: '查询事件中心事件，可按项目、类别和状态过滤。',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      categoryId: { type: 'string' },
      status: { type: 'string' },
    },
  },
  async execute(input, context) {
    return json({
      events: eventCenterService.listEvents({
        projectId: projectId(input, context),
        categoryId: optStr(input, 'categoryId'),
        status: optStr(input, 'status'),
      }),
    })
  },
}

export const eventGetHandler: ToolHandler = {
  name: 'event.get',
  description: '查看事件详情和消费记录。',
  inputSchema: {
    type: 'object',
    properties: { eventId: { type: 'string' } },
    required: ['eventId'],
  },
  async execute(input) {
    const event = eventCenterService.getEvent(requireStr(input, 'eventId'))
    if (!event) return json({ error: '事件不存在' })
    return json({ event, consumptions: eventCenterService.listConsumptions(event.id) })
  },
}

export const eventClaimNextHandler: ToolHandler = {
  name: 'event.claim_next',
  description: '领取当前 Agent 订阅下一个可消费事件。',
  inputSchema: {
    type: 'object',
    properties: { projectId: { type: 'string' } },
  },
  async execute(input, context) {
    if (!context.agentId) throw new Error('当前工具上下文缺少 agentId')
    return json(eventCenterService.claimNextEvent({ projectId: projectId(input, context), agentId: context.agentId }) ?? { event: null })
  },
}

export const eventConsumeHandler: ToolHandler = {
  name: 'event.consume',
  description: '提交事件消费结果。',
  inputSchema: {
    type: 'object',
    properties: {
      consumptionId: { type: 'string' },
      resultSummary: { type: 'string' },
      result: { type: 'object' },
      error: { type: 'string' },
    },
    required: ['consumptionId'],
  },
  async execute(input) {
    return json({
      consumption: eventCenterService.consumeEvent({
        consumptionId: requireStr(input, 'consumptionId'),
        resultSummary: optStr(input, 'resultSummary'),
        result: record(input.result),
        error: optStr(input, 'error'),
      }),
    })
  },
}

export const eventConvertToTaskHandler: ToolHandler = {
  name: 'event.convert_to_task',
  description: '把事件转成普通任务，并建立事件任务链接。',
  inputSchema: {
    type: 'object',
    properties: {
      eventId: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      assignAgentId: { type: 'string' },
      projectId: { type: 'string' },
    },
    required: ['eventId'],
  },
  async execute(input, context) {
    const task = eventCenterService.convertEventToTask(requireStr(input, 'eventId'), {
      title: optStr(input, 'title') ?? '来自事件中心的任务',
      description: optStr(input, 'description'),
      assignAgentId: optStr(input, 'assignAgentId'),
      projectId: projectId(input, context),
    })
    return json({ task })
  },
}

export const eventIgnoreHandler: ToolHandler = {
  name: 'event.ignore',
  description: '忽略事件中心中的事件。',
  inputSchema: {
    type: 'object',
    properties: { eventId: { type: 'string' } },
    required: ['eventId'],
  },
  async execute(input) {
    return json({ event: eventCenterService.ignoreEvent(requireStr(input, 'eventId')) })
  },
}

export const eventSubscriptionCreateHandler: ToolHandler = {
  name: 'event.subscription.create',
  description: '创建事件订阅规则，定义哪个 Agent 消费哪类事件。filter 顶层仅支持 minConfidence、priority、sourceType、payload；事件 payload 字段必须放入 filter.payload，例如 task.lifecycle 待办任务使用 {"payload":{"taskStatus":"backlog"}}。未在顶层声明的 key 会被当作 payload 字段处理。',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      name: { type: 'string' },
      categoryId: { type: 'string' },
      consumerAgentId: { type: 'string' },
      consumerLabel: { type: 'string' },
      actionMode: { type: 'string' },
      filter: {
        type: 'object',
        description: '订阅过滤条件。顶层支持 minConfidence、priority、sourceType、payload。payload 是事件 payload 字段过滤，值可为直接值、null、{"in":[...]}、{"exists":true/false}；schema 标记 x-filter 的字段在前端有快捷选项，但任意 payload 子字段都允许过滤。',
        properties: {
          minConfidence: { type: 'number', description: '最低置信度，0-1' },
          priority: { type: 'string', description: '事件优先级，如 low/medium/high' },
          sourceType: { type: 'string', description: '事件来源类型' },
          payload: {
            type: 'object',
            description: '事件 payload 字段过滤。值可为直接值、null、{"in":[...]}, 或 {"exists":true/false}。',
          },
        },
      },
      autoStart: { type: 'boolean' },
      consumerSessionMode: { type: 'string', enum: ['existing', 'new_each', 'new_fixed'] },
      consumerSessionId: { type: 'string' },
    },
    required: ['name', 'categoryId'],
  },
  async execute(input, context) {
    return json({
      subscription: eventCenterService.createSubscription({
        projectId: projectId(input, context),
        name: requireStr(input, 'name'),
        categoryId: requireStr(input, 'categoryId'),
        consumerAgentId: optStr(input, 'consumerAgentId'),
        consumerLabel: optStr(input, 'consumerLabel'),
        actionMode: optStr(input, 'actionMode'),
        filter: record(input.filter),
        autoStart: typeof input.autoStart === 'boolean' ? input.autoStart : undefined,
        consumerSessionMode: optConsumerSessionMode(input.consumerSessionMode),
        consumerSessionId: optStr(input, 'consumerSessionId'),
      }),
    })
  },
}

function optConsumerSessionMode(value: unknown): 'existing' | 'new_each' | 'new_fixed' | undefined {
  return value === 'existing' || value === 'new_each' || value === 'new_fixed' ? value : undefined
}
