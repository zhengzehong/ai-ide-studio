import { agentStore } from '../store/agents.js'
import { eventCategoryStore, type EventCategoryRow, type UpsertEventCategoryInput } from '../store/event-categories.js'
import {
  eventCenterEventStore,
  type EventCenterEventRow,
  type EventEvidenceItem,
  type EventListFilter,
  type EventListPage,
} from '../store/event-center-events.js'
import {
  eventSubscriptionStore,
  type CreateEventSubscriptionInput,
  type EventSubscriptionRow,
  type UpdateEventSubscriptionInput,
} from '../store/event-subscriptions.js'
import { eventConsumptionStore, type EventConsumptionRow } from '../store/event-consumptions.js'
import { eventTaskLinkStore } from '../store/event-task-links.js'
import { taskStore, type CreateTaskInput, type TaskRow } from '../store/tasks.js'
import { sessionStore, type SessionRow } from '../store/sessions.js'
import { sessionManager } from './sessions.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('event-center')
const autoConsumerQueues = new Map<string, Promise<void>>()
const TASK_LIFECYCLE_CATEGORY_ID = 'task.lifecycle'

const TASK_LIFECYCLE_SCHEMA = {
  type: 'object',
  properties: {
    taskId: { type: 'string', title: '任务 ID' },
    taskTitle: { type: 'string', title: '任务' },
    taskStatus: {
      type: 'string',
      title: '任务状态',
      enum: ['backlog', 'executing', 'needs_input', 'completed', 'cancelled'],
      'x-list': true,
      'x-filter': true,
    },
    previousStatus: { type: 'string', title: '原状态', 'x-list': true },
    assignedAgentId: { type: 'string', title: '指派 Agent', 'x-list': true, 'x-filter': true },
    changeType: { type: 'string', title: '变更类型', 'x-list': true, 'x-filter': true },
    stage: { type: 'string', title: '阶段' },
    source: { type: 'string', title: '来源', 'x-filter': true },
  },
}

export interface CreateEventInput {
  projectId?: string | null
  categoryId: string
  title: string
  summary?: string | null
  sourceType?: string
  sourceId?: string | null
  sourceLabel?: string | null
  priority?: string
  confidence?: number
  tags?: string[]
  payload?: Record<string, unknown>
  evidence?: EventEvidenceItem[]
  dedupeKey?: string | null
  createdByAgentId?: string | null
}

export interface ClaimNextEventInput {
  projectId?: string
  agentId: string
}

export interface ConsumeEventInput {
  consumptionId: string
  resultSummary?: string
  result?: Record<string, unknown>
  error?: string
}

export interface ClaimedEvent {
  event: EventCenterEventRow
  consumption: EventConsumptionRow
}

export interface RunEventConsumerResult {
  event: EventCenterEventRow
  consumption: EventConsumptionRow
  sessionId: string
}

export interface RunEventConsumerInput {
  consumptionId: string
  sessionId?: string
}

export const eventCenterService = {
  listCategories(projectId?: string | null): EventCategoryRow[] {
    ensureBuiltinEventCategories()
    return eventCategoryStore.list(projectId)
  },

  getCategory(categoryId: string, projectId?: string | null): EventCategoryRow | undefined {
    return eventCategoryStore.get(categoryId, projectId)
  },

  upsertCategory(input: UpsertEventCategoryInput): EventCategoryRow {
    const category = eventCategoryStore.upsert(input)
    emitUpdate({ categoryId: category.id, projectId: category.project_id, event: 'category.updated' })
    return category
  },

  toggleCategory(id: string, enabled: boolean, projectId?: string | null): EventCategoryRow | undefined {
    const category = eventCategoryStore.toggle(id, enabled, projectId)
    emitUpdate({ categoryId: id, projectId: category?.project_id ?? projectId ?? null, event: 'category.toggled', enabled })
    return category
  },

  deleteCategory(id: string, projectId?: string | null): { categoryId: string; deleted: boolean } {
    const category = eventCategoryStore.get(id, projectId)
    if (!category) throw new Error(`事件类别不存在: ${id}`)
    const references = eventCategoryStore.referenceCounts(id, projectId)
    if (references.events > 0 || references.subscriptions > 0) {
      throw new Error('已有事件或订阅使用该类别，请先停用类别')
    }
    const deleted = eventCategoryStore.remove(id, projectId)
    emitUpdate({ categoryId: id, projectId: category.project_id, event: 'category.deleted' })
    return { categoryId: id, deleted }
  },

  listEvents(filter?: EventListFilter): EventCenterEventRow[] {
    return eventCenterEventStore.list(filter)
  },

  listEventsPage(filter?: EventListFilter): EventListPage {
    return eventCenterEventStore.listPage(filter)
  },

  getEvent(eventId: string): EventCenterEventRow | undefined {
    return eventCenterEventStore.get(eventId)
  },

  createEvent(input: CreateEventInput): EventCenterEventRow {
    ensureBuiltinEventCategories()
    const category = eventCategoryStore.resolve(input.categoryId, input.projectId ?? undefined)
    if (!category || category.enabled !== 1) throw new Error(`事件类别不可用: ${input.categoryId}`)
    if (!input.title?.trim()) throw new Error('事件标题不能为空')
    assertAgentProject(input.createdByAgentId, input.projectId ?? undefined)
    assertCategoryAccess(category, input.createdByAgentId, 'writer')

    const event = eventCenterEventStore.create({
      ...input,
      categoryId: category.id,
      title: input.title.trim(),
      priority: input.priority ?? category.default_priority,
      confidence: clampConfidence(input.confidence),
      payload: input.payload ?? {},
      evidence: input.evidence ?? [],
    })

    const consumptions = evaluateSubscriptions(event)
    log.info({ eventId: event.id, categoryId: event.category_id, consumptions: consumptions.length }, '事件已创建')
    emitUpdate({ eventId: event.id, event: 'event.created' })
    return event
  },

  ignoreEvent(eventId: string): EventCenterEventRow {
    return updateEventStatus(eventId, 'ignored')
  },

  archiveEvent(eventId: string): EventCenterEventRow {
    return updateEventStatus(eventId, 'archived')
  },

  reopenEvent(eventId: string): EventCenterEventRow {
    return updateEventStatus(eventId, 'pending')
  },

  createSubscription(input: CreateEventSubscriptionInput): EventSubscriptionRow {
    const normalized = normalizeSubscriptionInput(input)
    const subscription = eventSubscriptionStore.create({
      ...normalized.input,
      filter: normalized.filter,
    })
    emitUpdate({ subscriptionId: subscription.id, event: 'subscription.created' })
    return subscription
  },

  listSubscriptions(projectId?: string): EventSubscriptionRow[] {
    return eventSubscriptionStore.list(projectId)
  },

  toggleSubscription(subscriptionId: string, enabled: boolean): EventSubscriptionRow | undefined {
    const subscription = eventSubscriptionStore.toggle(subscriptionId, enabled)
    emitUpdate({ subscriptionId, event: 'subscription.toggled', enabled })
    return subscription
  },

  updateSubscription(subscriptionId: string, input: UpdateEventSubscriptionInput): EventSubscriptionRow {
    const existing = eventSubscriptionStore.get(subscriptionId)
    if (!existing) throw new Error(`订阅规则不存在: ${subscriptionId}`)
    const normalized = normalizeSubscriptionInput(input)
    const subscription = eventSubscriptionStore.update(subscriptionId, {
      ...normalized.input,
      filter: normalized.filter,
    })
    if (!subscription) throw new Error(`订阅规则不存在: ${subscriptionId}`)
    emitUpdate({ subscriptionId, projectId: subscription.project_id, event: 'subscription.updated' })
    return subscription
  },

  deleteSubscription(subscriptionId: string): { subscriptionId: string; deleted: boolean } {
    const existing = eventSubscriptionStore.get(subscriptionId)
    if (!existing) throw new Error(`订阅规则不存在: ${subscriptionId}`)
    const deleted = eventSubscriptionStore.remove(subscriptionId)
    emitUpdate({ subscriptionId, projectId: existing.project_id, event: 'subscription.deleted' })
    return { subscriptionId, deleted }
  },

  listConsumptions(eventId: string): EventConsumptionRow[] {
    return eventConsumptionStore.listByEvent(eventId)
  },

  claimNextEvent(input: ClaimNextEventInput): ClaimedEvent | null {
    assertAgentProject(input.agentId, input.projectId)
    const candidates = eventConsumptionStore.listPendingForAgent(input)
    const match = candidates.find((candidate) => {
      const event = eventCenterEventStore.get(candidate.event_id)
      if (!event) return false
      const category = eventCategoryStore.resolve(event.category_id, event.project_id ?? undefined)
      return Boolean(category && hasCategoryAccess(category, input.agentId, 'consumer'))
    })
    if (!match) return null
    const consumption = eventConsumptionStore.claim(match.id)
    const event = eventCenterEventStore.get(consumption.event_id)
    if (!event) throw new Error(`事件不存在: ${consumption.event_id}`)
    const runningEvent = eventCenterEventStore.updateStatus(event.id, 'running') ?? event
    emitUpdate({ eventId: event.id, consumptionId: consumption.id, event: 'consumption.claimed' })
    return { event: runningEvent, consumption }
  },

  async runConsumer(input: string | RunEventConsumerInput): Promise<RunEventConsumerResult> {
    const runInput = typeof input === 'string' ? { consumptionId: input } : input
    const consumptionId = runInput.consumptionId
    const existing = eventConsumptionStore.get(consumptionId)
    if (!existing) throw new Error(`消费记录不存在: ${consumptionId}`)
    if (!existing.consumer_agent_id) throw new Error('消费记录没有绑定 Agent')
    if (existing.status !== 'pending') throw new Error('消费记录不是待处理状态')
    const event = eventCenterEventStore.get(existing.event_id)
    if (!event) throw new Error(`事件不存在: ${existing.event_id}`)
    assertAgentProject(existing.consumer_agent_id, event.project_id ?? undefined)
    const category = eventCategoryStore.resolve(event.category_id, event.project_id ?? undefined)
    if (!category) throw new Error(`事件类别不存在: ${event.category_id}`)
    assertCategoryAccess(category, existing.consumer_agent_id, 'consumer')
    const subscription = existing.subscription_id ? eventSubscriptionStore.get(existing.subscription_id) : undefined
    const session = await resolveConsumerSession({
      event,
      consumption: existing,
      subscription,
      requestedSessionId: runInput.sessionId,
    })

    const claimed = eventConsumptionStore.claim(existing.id)
    const consumption = eventConsumptionStore.setSession(claimed.id, session.id)
    const runningEvent = eventCenterEventStore.updateStatus(event.id, 'running') ?? event
    void sessionManager.enqueuePrompt(session.id, buildConsumerPrompt(event, consumption), undefined, { contextProjectId: event.project_id ?? undefined }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      log.error({ err, eventId: event.id, consumptionId: consumption.id, sessionId: session.id }, '事件消费 Agent 启动失败')
      eventConsumptionStore.complete(consumption.id, { error: message })
      eventCenterEventStore.updateStatus(event.id, 'failed')
      emitUpdate({ eventId: event.id, consumptionId: consumption.id, sessionId: session.id, event: 'consumption.consumer_failed' })
    })
    emitUpdate({ eventId: event.id, consumptionId: consumption.id, sessionId: session.id, event: 'consumption.consumer_started' })
    return { event: runningEvent, consumption, sessionId: session.id }
  },

  consumeEvent(input: ConsumeEventInput): EventConsumptionRow {
    const consumption = eventConsumptionStore.complete(input.consumptionId, {
      resultSummary: input.resultSummary,
      result: input.result,
      error: input.error,
    })
    if (input.error) eventCenterEventStore.updateStatus(consumption.event_id, 'failed')
    else markEventConsumedIfDone(consumption.event_id)
    emitUpdate({ eventId: consumption.event_id, consumptionId: consumption.id, event: 'consumption.completed' })
    return consumption
  },

  convertEventToTask(eventId: string, input: Omit<CreateTaskInput, 'source' | 'projectId'> & { projectId?: string }): TaskRow {
    const event = eventCenterEventStore.get(eventId)
    if (!event) throw new Error(`事件不存在: ${eventId}`)
    const task = taskStore.create({
      ...input,
      title: input.title || event.title,
      description: input.description ?? buildTaskDescription(event),
      source: 'event',
      projectId: input.projectId ?? event.project_id ?? undefined,
    })
    emitConvertedTaskLifecycleEvent(task)
    eventTaskLinkStore.create(event.id, task.id)
    eventCenterEventStore.updateStatus(event.id, 'task')
    emitUpdate({ eventId: event.id, taskId: task.id, event: 'event.converted_to_task' })
    return task
  },
}

export function ensureBuiltinEventCategories(): void {
  if (eventCategoryStore.get(TASK_LIFECYCLE_CATEGORY_ID)) return
  eventCategoryStore.upsert({
    id: TASK_LIFECYCLE_CATEGORY_ID,
    name: '任务生命周期',
    description: '记录任务创建、指派、执行、阻塞、待审查、完成和取消等生命周期变化。',
    schema: TASK_LIFECYCLE_SCHEMA,
    defaultPriority: 'medium',
    allowedWriters: ['*'],
    allowedConsumers: ['*'],
    enabled: true,
  })
}

function emitConvertedTaskLifecycleEvent(task: TaskRow): void {
  try {
    eventCenterService.createEvent({
      projectId: task.project_id ?? undefined,
      categoryId: TASK_LIFECYCLE_CATEGORY_ID,
      title: `任务变更：${task.title}`,
      summary: task.stage || `任务状态：${task.status}`,
      sourceType: 'task',
      sourceId: task.id,
      sourceLabel: task.title,
      priority: 'medium',
      payload: {
        taskId: task.id,
        taskTitle: task.title,
        taskStatus: task.status,
        previousStatus: null,
        assignedAgentId: task.assigned_agent_id,
        changeType: 'created',
        stage: task.stage,
        source: task.source,
      },
    })
  } catch (err) {
    log.warn({ err, taskId: task.id }, 'Failed to write converted task lifecycle event')
  }
}

function evaluateSubscriptions(event: EventCenterEventRow): EventConsumptionRow[] {
  const subscriptions = eventSubscriptionStore
    .listMatching(event.category_id, event.project_id)
    .filter((subscription) => matchesSubscription(subscription, event))
  return subscriptions.map((subscription) => {
    const consumption = eventConsumptionStore.create({
      eventId: event.id,
      subscriptionId: subscription.id,
      projectId: event.project_id,
      consumerAgentId: subscription.consumer_agent_id,
      consumerLabel: subscription.consumer_label,
    })
    if (subscription.auto_start === 1 && subscription.consumer_agent_id && consumption.status === 'pending') {
      scheduleAutoConsumer(subscription.id, consumption.id)
    }
    return consumption
  })
}

function scheduleAutoConsumer(subscriptionId: string, consumptionId: string): void {
  const previous = autoConsumerQueues.get(subscriptionId) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      try {
        await eventCenterService.runConsumer({ consumptionId })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error({ err, subscriptionId, consumptionId }, '事件自动消费失败')
        const consumption = eventConsumptionStore.get(consumptionId)
        if (consumption?.status === 'pending') {
          eventConsumptionStore.complete(consumptionId, { error: message })
          eventCenterEventStore.updateStatus(consumption.event_id, 'failed')
          emitUpdate({ eventId: consumption.event_id, consumptionId, event: 'consumption.auto_failed' })
        }
      }
    })
  autoConsumerQueues.set(subscriptionId, next)
  next
    .finally(() => {
      if (autoConsumerQueues.get(subscriptionId) === next) autoConsumerQueues.delete(subscriptionId)
    })
    .catch(() => undefined)
}

async function resolveConsumerSession(input: {
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

function validateConsumerSession(sessionId: string, agentId: string, projectId?: string): SessionRow {
  const session = sessionStore.get(sessionId)
  if (!session) throw new Error(`Session not found: ${sessionId}`)
  if (session.status !== 'active') throw new Error(`Session is not active: ${sessionId}`)
  if (session.agent_id !== agentId) throw new Error(`Session ${sessionId} does not belong to consumer Agent ${agentId}`)
  if (projectId && session.project_id !== projectId) throw new Error(`Session ${sessionId} is outside current project`)
  return session
}

function validateSubscriptionSession(input: CreateEventSubscriptionInput): void {
  if (!input.consumerAgentId) return
  if (input.consumerSessionMode === 'existing' && !input.consumerSessionId) {
    throw new Error('existing consumer session mode requires consumerSessionId')
  }
  if (input.consumerSessionId) validateConsumerSession(input.consumerSessionId, input.consumerAgentId, input.projectId ?? undefined)
}

function normalizeSubscriptionInput(input: CreateEventSubscriptionInput | UpdateEventSubscriptionInput): {
  input: UpdateEventSubscriptionInput
  filter: Record<string, unknown>
} {
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

function matchesSubscription(subscription: EventSubscriptionRow, event: EventCenterEventRow): boolean {
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

function normalizeSubscriptionFilter(input: Record<string, unknown> | undefined, category: EventCategoryRow | undefined): Record<string, unknown> {
  if (!input || Object.keys(input).length === 0) return {}
  const allowedTopLevelKeys = new Set(['minConfidence', 'priority', 'sourceType', 'payload'])
  const payloadFieldKeys = filterablePayloadFields(category)
  const normalized: Record<string, unknown> = {}
  const payload = input.payload === undefined ? {} : recordField(input.payload)
  for (const [key, value] of Object.entries(input)) {
    if (key === 'payload') {
      continue
    }
    if (allowedTopLevelKeys.has(key)) {
      normalized[key] = value
      continue
    }
    if (payloadFieldKeys.has(key)) {
      payload[key] = value
      continue
    }
    throw new Error(`未知订阅过滤字段: ${key}。Payload 字段请放在 filter.payload.${key}`)
  }
  if (Object.keys(payload).length > 0) normalized.payload = payload
  return normalized
}

function filterablePayloadFields(category: EventCategoryRow | undefined): Set<string> {
  if (!category) return new Set()
  const schema = parseJson(category.schema_json)
  const properties = schema.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return new Set()
  const fields = new Set<string>()
  for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const field = value as Record<string, unknown>
      if (field['x-filter'] === true) fields.add(key)
    }
  }
  return fields
}

function recordField(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...value as Record<string, unknown> }
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

function updateEventStatus(eventId: string, status: string): EventCenterEventRow {
  const event = eventCenterEventStore.updateStatus(eventId, status)
  if (!event) throw new Error(`事件不存在: ${eventId}`)
  emitUpdate({ eventId, event: `event.${status}` })
  return event
}

function markEventConsumedIfDone(eventId: string): void {
  const consumptions = eventConsumptionStore.listByEvent(eventId)
  if (consumptions.some((consumption) => consumption.status === 'running' || consumption.status === 'pending')) return
  eventCenterEventStore.updateStatus(eventId, 'consumed')
}

function assertAgentProject(agentId: string | null | undefined, projectId: string | undefined): void {
  if (!agentId || !projectId) return
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`Agent 不存在: ${agentId}`)
  if (agent.project_id !== projectId) throw new Error(`Project mismatch: Agent ${agentId} is outside current project`)
}

function assertCategoryAccess(category: EventCategoryRow, agentId: string | null | undefined, role: 'writer' | 'consumer'): void {
  if (hasCategoryAccess(category, agentId, role)) return
  throw new Error(`Agent ${agentId} is not allowed as event ${role} for category ${category.id}`)
}

function hasCategoryAccess(category: EventCategoryRow, agentId: string | null | undefined, role: 'writer' | 'consumer'): boolean {
  if (!agentId) return true
  const allowed = parseStringArray(role === 'writer' ? category.allowed_writers_json : category.allowed_consumers_json)
  if (allowed.includes('*') || allowed.includes(agentId)) return true
  const agent = agentStore.get(agentId)
  return Boolean(agent && allowed.includes(agent.type))
}

function agentLabel(agentId: string | null | undefined): string | null {
  if (!agentId) return null
  return agentStore.get(agentId)?.name ?? agentId
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function parseJson(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
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

function buildTaskDescription(event: EventCenterEventRow): string {
  const parts = [`来自事件中心：${event.title}`]
  if (event.summary) parts.push(event.summary)
  parts.push(`事件 ID：${event.id}`)
  return parts.join('\n\n')
}

function buildConsumerPrompt(event: EventCenterEventRow, consumption: EventConsumptionRow): string {
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

function emitUpdate(data: Record<string, unknown>): void {
  events.emit('event-center:update', data)
}
