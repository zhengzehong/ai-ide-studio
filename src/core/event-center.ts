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
import { sessionManager } from './sessions.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { ensureBuiltinEventCategories, TASK_LIFECYCLE_CATEGORY_ID } from './event-center-builtin.js'
import {
  assertAgentProject,
  assertCategoryAccess,
  assertRequiredPayloadFields,
  buildConsumerPrompt,
  buildTaskDescription,
  clampConfidence,
  hasCategoryAccess,
  mergeEventPayload,
  normalizeSubscriptionInput,
  matchesSubscription,
  resolveConsumerSession,
} from './event-center-helpers.js'

export { ensureBuiltinEventCategories } from './event-center-builtin.js'

const log = createChildLogger('event-center')
const autoConsumerQueues = new Map<string, Promise<void>>()

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

    const payload = mergeEventPayload(category, input.payload)
    assertRequiredPayloadFields(category, payload)

    const event = eventCenterEventStore.create({
      ...input,
      categoryId: category.id,
      title: input.title.trim(),
      priority: input.priority ?? category.default_priority,
      confidence: clampConfidence(input.confidence),
      payload,
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

function emitUpdate(data: Record<string, unknown>): void {
  events.emit('event-center:update', data)
}
