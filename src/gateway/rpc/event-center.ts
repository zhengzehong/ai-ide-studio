import { eventCenterService } from '../../core/event-center.js'
import type { RpcHandlerMap } from './types.js'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function hasPaginationInput(msg: Record<string, unknown>): boolean {
  return typeof msg.limit === 'number' || typeof msg.offset === 'number' || typeof msg.keyword === 'string'
}

export const eventCenterRpcHandlers: RpcHandlerMap = {
  'eventCategories.list'(msg, { sendResult }) {
    sendResult(eventCenterService.listCategories(msg.projectId as string | undefined))
  },

  'eventCategories.create'(msg, { sendResult }) {
    sendResult(eventCenterService.upsertCategory({
      id: msg.categoryId as string,
      projectId: msg.projectId as string | undefined,
      name: msg.name as string,
      description: msg.description as string | undefined,
      schema: record(msg.schema),
      defaultPriority: msg.defaultPriority as string | undefined,
      allowedWriters: stringArray(msg.allowedWriters),
      allowedConsumers: stringArray(msg.allowedConsumers),
      enabled: msg.enabled as boolean | undefined,
    }))
  },

  'eventCategories.update'(msg, { sendResult }) {
    sendResult(eventCenterService.upsertCategory({
      id: msg.categoryId as string,
      projectId: msg.projectId as string | undefined,
      name: msg.name as string,
      description: msg.description as string | undefined,
      schema: record(msg.schema),
      defaultPriority: msg.defaultPriority as string | undefined,
      allowedWriters: stringArray(msg.allowedWriters),
      allowedConsumers: stringArray(msg.allowedConsumers),
      enabled: msg.enabled as boolean | undefined,
    }))
  },

  'eventCategories.toggle'(msg, { sendResult }) {
    sendResult(eventCenterService.toggleCategory(msg.categoryId as string, msg.enabled as boolean, msg.projectId as string | undefined))
  },

  'eventCategories.delete'(msg, { sendResult, sendError }) {
    try {
      sendResult(eventCenterService.deleteCategory(msg.categoryId as string, msg.projectId as string | undefined))
    } catch (err) {
      sendError(err instanceof Error ? err.message : '删除事件类别失败')
    }
  },

  'events.list'(msg, { sendResult }) {
    const filter = {
      projectId: msg.projectId as string | undefined,
      categoryId: msg.categoryId as string | undefined,
      status: msg.status as string | undefined,
      keyword: msg.keyword as string | undefined,
      limit: numberValue(msg.limit),
      offset: numberValue(msg.offset),
    }
    sendResult(hasPaginationInput(msg) ? eventCenterService.listEventsPage(filter) : eventCenterService.listEvents(filter))
  },

  'events.get'(msg, { sendResult, sendError }) {
    const event = eventCenterService.getEvent(msg.eventId as string)
    if (!event) return sendError('事件不存在')
    sendResult({
      ...event,
      consumptions: eventCenterService.listConsumptions(event.id),
    })
  },

  'events.create'(msg, { sendResult }) {
    sendResult(eventCenterService.createEvent({
      projectId: msg.projectId as string | undefined,
      categoryId: msg.categoryId as string,
      title: msg.title as string,
      summary: msg.summary as string | undefined,
      sourceType: msg.sourceType as string | undefined,
      sourceId: msg.sourceId as string | undefined,
      sourceLabel: msg.sourceLabel as string | undefined,
      priority: msg.priority as string | undefined,
      confidence: msg.confidence as number | undefined,
      tags: stringArray(msg.tags),
      payload: record(msg.payload),
      evidence: Array.isArray(msg.evidence) ? msg.evidence as never : undefined,
      dedupeKey: msg.dedupeKey as string | undefined,
      createdByAgentId: msg.createdByAgentId as string | undefined,
    }))
  },

  'events.ignore'(msg, { sendResult }) {
    sendResult(eventCenterService.ignoreEvent(msg.eventId as string))
  },

  'events.archive'(msg, { sendResult }) {
    sendResult(eventCenterService.archiveEvent(msg.eventId as string))
  },

  'events.reopen'(msg, { sendResult }) {
    sendResult(eventCenterService.reopenEvent(msg.eventId as string))
  },

  'events.convertToTask'(msg, { sendResult }) {
    sendResult(eventCenterService.convertEventToTask(msg.eventId as string, {
      title: msg.title as string,
      description: msg.description as string | undefined,
      assignAgentId: msg.assignAgentId as string | undefined,
      projectId: msg.projectId as string | undefined,
    }))
  },

  'eventSubscriptions.list'(msg, { sendResult }) {
    sendResult(eventCenterService.listSubscriptions(msg.projectId as string | undefined))
  },

  'eventSubscriptions.create'(msg, { sendResult }) {
    sendResult(eventCenterService.createSubscription({
      projectId: msg.projectId as string | undefined,
      name: msg.name as string,
      categoryId: msg.categoryId as string,
      consumerAgentId: msg.consumerAgentId as string | undefined,
      consumerLabel: msg.consumerLabel as string | undefined,
      actionMode: msg.actionMode as string | undefined,
      filter: record(msg.filter),
      enabled: msg.enabled as boolean | undefined,
      autoStart: msg.autoStart as boolean | undefined,
      consumerSessionMode: msg.consumerSessionMode as never,
      consumerSessionId: msg.consumerSessionId as string | null | undefined,
    }))
  },

  'eventSubscriptions.toggle'(msg, { sendResult }) {
    sendResult(eventCenterService.toggleSubscription(msg.subscriptionId as string, msg.enabled as boolean))
  },

  'eventSubscriptions.update'(msg, { sendResult }) {
    sendResult(eventCenterService.updateSubscription(msg.subscriptionId as string, {
      projectId: msg.projectId as string | undefined,
      name: msg.name as string,
      categoryId: msg.categoryId as string,
      consumerAgentId: msg.consumerAgentId as string | undefined,
      consumerLabel: msg.consumerLabel as string | undefined,
      actionMode: msg.actionMode as string | undefined,
      filter: record(msg.filter),
      enabled: msg.enabled as boolean | undefined,
      autoStart: msg.autoStart as boolean | undefined,
      consumerSessionMode: msg.consumerSessionMode as never,
      consumerSessionId: msg.consumerSessionId as string | null | undefined,
    }))
  },

  'eventSubscriptions.delete'(msg, { sendResult, sendError }) {
    try {
      sendResult(eventCenterService.deleteSubscription(msg.subscriptionId as string))
    } catch (err) {
      sendError(err instanceof Error ? err.message : '删除订阅规则失败')
    }
  },

  'eventConsumptions.claimNext'(msg, { sendResult }) {
    sendResult(eventCenterService.claimNextEvent({
      projectId: msg.projectId as string | undefined,
      agentId: msg.agentId as string,
    }))
  },

  async 'eventConsumptions.run'(msg, { sendResult }) {
    sendResult(await eventCenterService.runConsumer({
      consumptionId: msg.consumptionId as string,
      sessionId: msg.sessionId as string | undefined,
    }))
  },

  'eventConsumptions.consume'(msg, { sendResult }) {
    sendResult(eventCenterService.consumeEvent({
      consumptionId: msg.consumptionId as string,
      resultSummary: msg.resultSummary as string | undefined,
      result: record(msg.result),
      error: msg.error as string | undefined,
    }))
  },
}
