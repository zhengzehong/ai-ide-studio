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
} from '../store/event-subscriptions.js'
import { eventConsumptionStore, type EventConsumptionRow } from '../store/event-consumptions.js'
import { eventTaskLinkStore } from '../store/event-task-links.js'
import { taskStore, type CreateTaskInput, type TaskRow } from '../store/tasks.js'
import { sessionManager } from './sessions.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('event-center')

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

export const eventCenterService = {
  listCategories(): EventCategoryRow[] {
    return eventCategoryStore.list()
  },

  upsertCategory(input: UpsertEventCategoryInput): EventCategoryRow {
    const category = eventCategoryStore.upsert(input)
    emitUpdate({ categoryId: category.id, event: 'category.updated' })
    return category
  },

  toggleCategory(id: string, enabled: boolean): EventCategoryRow | undefined {
    const category = eventCategoryStore.toggle(id, enabled)
    emitUpdate({ categoryId: id, event: 'category.toggled', enabled })
    return category
  },

  deleteCategory(id: string): { categoryId: string; deleted: boolean } {
    const category = eventCategoryStore.get(id)
    if (!category) throw new Error(`事件类别不存在: ${id}`)
    const references = eventCategoryStore.referenceCounts(id)
    if (references.events > 0 || references.subscriptions > 0) {
      throw new Error('已有事件或订阅使用该类别，请先停用类别')
    }
    const deleted = eventCategoryStore.remove(id)
    emitUpdate({ categoryId: id, event: 'category.deleted' })
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
    const category = eventCategoryStore.get(input.categoryId)
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
    if (!input.name?.trim()) throw new Error('订阅名称不能为空')
    const category = eventCategoryStore.get(input.categoryId)
    if (!category) throw new Error(`事件类别不存在: ${input.categoryId}`)
    assertAgentProject(input.consumerAgentId, input.projectId ?? undefined)
    assertCategoryAccess(category, input.consumerAgentId, 'consumer')
    const subscription = eventSubscriptionStore.create({
      ...input,
      name: input.name.trim(),
      consumerLabel: input.consumerLabel ?? agentLabel(input.consumerAgentId),
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

  listConsumptions(eventId: string): EventConsumptionRow[] {
    return eventConsumptionStore.listByEvent(eventId)
  },

  claimNextEvent(input: ClaimNextEventInput): ClaimedEvent | null {
    assertAgentProject(input.agentId, input.projectId)
    const candidates = eventConsumptionStore.listPendingForAgent(input)
    const match = candidates.find((candidate) => {
      const event = eventCenterEventStore.get(candidate.event_id)
      if (!event) return false
      const category = eventCategoryStore.get(event.category_id)
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

  async runConsumer(consumptionId: string): Promise<RunEventConsumerResult> {
    const existing = eventConsumptionStore.get(consumptionId)
    if (!existing) throw new Error(`消费记录不存在: ${consumptionId}`)
    if (!existing.consumer_agent_id) throw new Error('消费记录没有绑定 Agent')
    if (existing.status !== 'pending') throw new Error('消费记录不是待处理状态')
    const event = eventCenterEventStore.get(existing.event_id)
    if (!event) throw new Error(`事件不存在: ${existing.event_id}`)
    assertAgentProject(existing.consumer_agent_id, event.project_id ?? undefined)
    const category = eventCategoryStore.get(event.category_id)
    if (!category) throw new Error(`事件类别不存在: ${event.category_id}`)
    assertCategoryAccess(category, existing.consumer_agent_id, 'consumer')

    const consumption = eventConsumptionStore.claim(existing.id)
    const runningEvent = eventCenterEventStore.updateStatus(event.id, 'running') ?? event
    const session = await sessionManager.createSession(existing.consumer_agent_id, undefined, event.project_id ?? undefined)
    void sessionManager.sendPrompt(session.id, buildConsumerPrompt(event, consumption)).catch((err: unknown) => {
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
    eventTaskLinkStore.create(event.id, task.id)
    eventCenterEventStore.updateStatus(event.id, 'task')
    emitUpdate({ eventId: event.id, taskId: task.id, event: 'event.converted_to_task' })
    return task
  },
}

function evaluateSubscriptions(event: EventCenterEventRow): EventConsumptionRow[] {
  const subscriptions = eventSubscriptionStore
    .listMatching(event.category_id, event.project_id)
    .filter((subscription) => matchesSubscription(subscription, event))
  return subscriptions.map((subscription) => eventConsumptionStore.create({
    eventId: event.id,
    subscriptionId: subscription.id,
    projectId: event.project_id,
    consumerAgentId: subscription.consumer_agent_id,
    consumerLabel: subscription.consumer_label,
  }))
}

function matchesSubscription(subscription: EventSubscriptionRow, event: EventCenterEventRow): boolean {
  const filter = parseJson(subscription.filter_json)
  const minConfidence = numberField(filter.minConfidence)
  if (minConfidence !== undefined && event.confidence < minConfidence) return false
  const priority = typeof filter.priority === 'string' ? filter.priority : undefined
  if (priority && event.priority !== priority) return false
  const sourceType = typeof filter.sourceType === 'string' ? filter.sourceType : undefined
  if (sourceType && event.source_type !== sourceType) return false
  return true
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
