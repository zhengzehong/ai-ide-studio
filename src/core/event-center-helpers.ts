import { agentStore } from '../store/agents.js'
import type { EventCategoryRow } from '../store/event-categories.js'
import { eventCategoryStore } from '../store/event-categories.js'
import { ensureBuiltinEventCategories } from './event-center-builtin.js'
import type { EventCenterEventRow } from '../store/event-center-events.js'
import type { EventConsumptionRow } from '../store/event-consumptions.js'
import type {
  CreateEventSubscriptionInput,
  EventSubscriptionRow,
  UpdateEventSubscriptionInput,
} from '../store/event-subscriptions.js'
import { eventSubscriptionStore } from '../store/event-subscriptions.js'
import type { SessionRow } from '../store/sessions.js'
import { sessionStore } from '../store/sessions.js'
import { sessionManager } from './sessions.js'
import { createChildLogger } from './logger.js'
import { filterablePayloadFields, isPayloadValuePresent, parseCategorySchema, schemaDefaults, schemaRequiredFields } from './event-center-schema.js'

const log = createChildLogger('event-center')

const ALLOWED_TOP_LEVEL_FILTER_KEYS = new Set(['minConfidence', 'priority', 'sourceType', 'payload'])

export interface NormalizeSubscriptionResult {
  input: UpdateEventSubscriptionInput
  filter: Record<string, unknown>
}

export function normalizeSubscriptionInput(input: CreateEventSubscriptionInput | UpdateEventSubscriptionInput): NormalizeSubscriptionResult {
  ensureBuiltinEventCategories()
  if (!input.name?.trim()) throw new Error('订阅名称不能为空')
  const category = eventCategoryStore.resolve(input.categoryId, input.projectId ?? undefined)
  if (!category) throw new Error(`事件类别不存在: ${input.categoryId}`)
  assertAgentProject(input.consumerAgentId, input.projectId ?? undefined)
  assertCategoryAccess(category, input.consumerAgentId, 'consumer')
  validateSubscriptionSession(input)
  const filter = normalizeSubscriptionFilter(input.filter, category)
  const consumerSessionMode = input.consumerSessionMode ?? 'new_each'
  return {
    input: {
      ...input,
      name: input.name.trim(),
      consumerLabel: input.consumerLabel ?? agentLabel(input.consumerAgentId),
      consumerSessionMode,
      consumerSessionId: consumerSessionMode === 'new_each' ? null : input.consumerSessionId,
    },
    filter,
  }
}

export function normalizeSubscriptionFilter(
  input: Record<string, unknown> | undefined,
  category?: EventCategoryRow | null,
): Record<string, unknown> {
  if (!input || Object.keys(input).length === 0) return {}
  const payloadFieldKeys = filterablePayloadFields(category ?? undefined)
  const normalized: Record<string, unknown> = {}
  const payload = input.payload === undefined ? {} : recordField(input.payload)
  for (const [key, value] of Object.entries(input)) {
    if (key === 'payload') continue
    if (ALLOWED_TOP_LEVEL_FILTER_KEYS.has(key)) {
      normalized[key] = value
      continue
    }
    if (payloadFieldKeys.has(key)) {
      payload[key] = value
      continue
    }
    payload[key] = value
  }
  if (Object.keys(payload).length > 0) normalized.payload = payload
  return normalized
}

export function matchesSubscription(subscription: EventSubscriptionRow, event: EventCenterEventRow): boolean {
  const category = eventCategoryStore.get(event.category_id)
  let filter: Record<string, unknown>
  try {
    filter = normalizeSubscriptionFilter(parseJson(subscription.filter_json), category)
  } catch (err) {
    log.warn({ err, subscriptionId: subscription.id, eventId: event.id }, '事件订阅过滤条件无效，已跳过')
    return false
  }
  const minConfidence = numberField(filter.minConfidence)
  if (minConfidence !== undefined && event.confidence < minConfidence) return false
  const priority = typeof filter.priority === 'string' ? filter.priority : undefined
  if (priority && event.priority !== priority) return false
  const sourceType = typeof filter.sourceType === 'string' ? filter.sourceType : undefined
  if (sourceType && event.source_type !== sourceType) return false
  if (!matchesPayloadFilter(filter.payload, parseJson(event.payload_json))) return false
  return true
}

export function mergeEventPayload(category: EventCategoryRow, inputPayload: Record<string, unknown> | undefined): Record<string, unknown> {
  const schema = parseCategorySchema(category)
  const defaults = schemaDefaults(schema)
  const payload: Record<string, unknown> = { ...defaults }
  if (inputPayload) {
    for (const [key, value] of Object.entries(inputPayload)) {
      payload[key] = value
    }
  }
  return payload
}

export function assertRequiredPayloadFields(category: EventCategoryRow, payload: Record<string, unknown>): void {
  const schema = parseCategorySchema(category)
  const requiredFields = schemaRequiredFields(schema)
  if (requiredFields.length === 0) return
  const missing: string[] = []
  for (const field of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(payload, field) || !isPayloadValuePresent(payload[field])) {
      missing.push(field)
    }
  }
  if (missing.length > 0) {
    throw new Error(`事件类别 ${category.id} 缺少必填字段: ${missing.join(', ')}`)
  }
}

export function assertAgentProject(agentId: string | null | undefined, projectId: string | undefined): void {
  if (!agentId || !projectId) return
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`Agent 不存在: ${agentId}`)
  if (agent.project_id !== projectId) throw new Error(`Project mismatch: Agent ${agentId} is outside current project`)
}

export function assertCategoryAccess(category: EventCategoryRow, agentId: string | null | undefined, role: 'writer' | 'consumer'): void {
  if (hasCategoryAccess(category, agentId, role)) return
  throw new Error(`Agent ${agentId} is not allowed as event ${role} for category ${category.id}`)
}

export function hasCategoryAccess(category: EventCategoryRow, agentId: string | null | undefined, role: 'writer' | 'consumer'): boolean {
  if (!agentId) return true
  const allowed = parseStringArray(role === 'writer' ? category.allowed_writers_json : category.allowed_consumers_json)
  if (allowed.includes('*') || allowed.includes(agentId)) return true
  const agent = agentStore.get(agentId)
  return Boolean(agent && allowed.includes(agent.type))
}

export function agentLabel(agentId: string | null | undefined): string | null {
  if (!agentId) return null
  return agentStore.get(agentId)?.name ?? agentId
}

export function clampConfidence(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

export function buildTaskDescription(event: EventCenterEventRow): string {
  const parts = [`来自事件中心：${event.title}`]
  if (event.summary) parts.push(event.summary)
  parts.push(`事件 ID：${event.id}`)
  return parts.join('\n\n')
}

export function buildConsumerPrompt(event: EventCenterEventRow, consumption: EventConsumptionRow): string {
  return `[系统提示] 这是一条由 AI IDE Studio 事件中心触发的事件消费任务。
请分析下面的事件，并在完成后调用 event.consume 提交结果。

━━━ 事件信息 ━━━
事件 ID：${event.id}
消费记录 ID：${consumption.id}
类别：${event.category_id}
标题：${event.title}
摘要：${event.summary || '（无）'}
优先级：${event.priority}
置信度：${event.confidence}
Payload JSON：
${event.payload_json}

━━━ 执行要求 ━━━
1. 先判断这个事件是否值得继续处理。
2. 给出简短结论、推荐动作和必要证据。
3. 完成后调用 event.consume，参数 consumptionId 必须使用 "${consumption.id}"。`
}

export function validateConsumerSession(sessionId: string, agentId: string, projectId?: string): SessionRow {
  const session = sessionStore.get(sessionId)
  if (!session) throw new Error(`Session not found: ${sessionId}`)
  if (session.status !== 'active') throw new Error(`Session is not active: ${sessionId}`)
  if (session.agent_id !== agentId) throw new Error(`Session ${sessionId} does not belong to consumer Agent ${agentId}`)
  if (projectId && session.project_id !== projectId) throw new Error(`Session ${sessionId} is outside current project`)
  return session
}

export function validateSubscriptionSession(input: CreateEventSubscriptionInput): void {
  if (!input.consumerAgentId) return
  if (input.consumerSessionMode === 'existing' && !input.consumerSessionId) {
    throw new Error('existing consumer session mode requires consumerSessionId')
  }
  if (input.consumerSessionId) validateConsumerSession(input.consumerSessionId, input.consumerAgentId, input.projectId ?? undefined)
}

export async function resolveConsumerSession(input: {
  event: EventCenterEventRow
  consumption: EventConsumptionRow
  subscription?: EventSubscriptionRow
  requestedSessionId?: string
}): Promise<SessionRow> {
  const agentId = input.consumption.consumer_agent_id
  if (!agentId) throw new Error('消费记录没有绑定 Agent')
  const projectId = input.event.project_id ?? undefined
  if (input.requestedSessionId) return validateConsumerSession(input.requestedSessionId, agentId, projectId)

  const mode = input.subscription?.consumer_session_mode ?? 'new_each'
  if (mode === 'existing') {
    if (!input.subscription?.consumer_session_id) throw new Error('订阅规则没有指定消费会话')
    return validateConsumerSession(input.subscription.consumer_session_id, agentId, projectId)
  }
  if (mode === 'new_fixed') {
    if (input.subscription?.consumer_session_id) return validateConsumerSession(input.subscription.consumer_session_id, agentId, projectId)
    const session = await sessionManager.createSession(agentId, undefined, projectId)
    if (input.subscription) eventSubscriptionStore.setConsumerSession(input.subscription.id, session.id)
    return session
  }
  return sessionManager.createSession(agentId, undefined, projectId)
}

function recordField(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...(value as Record<string, unknown>) }
  throw new Error('filter.payload 必须是对象')
}

function matchesPayloadFilter(filter: unknown, payload: Record<string, unknown>): boolean {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return true
  return Object.entries(filter as Record<string, unknown>).every(([path, expected]) => {
    const resolved = getPayloadValue(payload, path)
    return matchesPayloadValue(resolved.value, resolved.exists, expected)
  })
}

function matchesPayloadValue(value: unknown, exists: boolean, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    const record = expected as Record<string, unknown>
    if (typeof record.exists === 'boolean' && record.exists !== exists) return false
    if (Array.isArray(record.in)) return record.in.some((item) => sameJsonValue(value, item))
    if (Object.prototype.hasOwnProperty.call(record, 'eq')) return sameJsonValue(value, record.eq)
    if (Object.keys(record).length === 1 && typeof record.exists === 'boolean') return true
  }
  if (expected === null) return exists && value === null
  return exists && sameJsonValue(value, expected)
}

function getPayloadValue(payload: Record<string, unknown>, path: string): { exists: boolean; value: unknown } {
  const parts = path.split('.').filter(Boolean)
  let current: unknown = payload
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return { exists: false, value: undefined }
    const record = current as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(record, part)) return { exists: false, value: undefined }
    current = record[part]
  }
  return { exists: parts.length > 0, value: current }
}

function sameJsonValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function parseJson(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
