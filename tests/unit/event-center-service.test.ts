import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { eventCategoryStore } from '../../src/store/event-categories.js'
import { eventConsumptionStore } from '../../src/store/event-consumptions.js'
import { eventCenterService } from '../../src/core/event-center.js'
import { sessionManager } from '../../src/core/sessions.js'
import { eventSubscriptionStore } from '../../src/store/event-subscriptions.js'
import { sessionStore } from '../../src/store/sessions.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-event-center-'))
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('event center service', () => {
  test('seeds phase-one default categories', () => {
    expect(eventCategoryStore.list().map((category) => category.id).sort()).toEqual([
      'ai.hot_project',
      'repo.commit',
      'task.candidate',
      'work.shipped',
    ])
  })

  test('scopes categories by project and resolves project overrides before global defaults', () => {
    const projectA = projectStore.create({ name: 'Project A', workDir: resolve(tmp, 'a') })
    const projectB = projectStore.create({ name: 'Project B', workDir: resolve(tmp, 'b') })

    const globalCategory = eventCenterService.upsertCategory({
      id: 'custom.scope',
      name: 'Global Scope',
      defaultPriority: 'low',
    })
    const projectOverride = eventCenterService.upsertCategory({
      projectId: projectA.id,
      id: 'custom.scope',
      name: 'Project A Scope',
      defaultPriority: 'high',
    })
    const projectOnly = eventCenterService.upsertCategory({
      projectId: projectB.id,
      id: 'custom.only_b',
      name: 'Project B Only',
      defaultPriority: 'medium',
    })

    expect(globalCategory.project_id).toBeNull()
    expect(projectOverride.project_id).toBe(projectA.id)
    expect(projectOnly.project_id).toBe(projectB.id)

    expect(eventCenterService.listCategories().find((category) => category.id === 'custom.scope')?.name).toBe('Global Scope')
    expect(eventCenterService.listCategories(projectA.id).find((category) => category.id === 'custom.scope')?.name).toBe('Project A Scope')
    expect(eventCenterService.listCategories(projectB.id).find((category) => category.id === 'custom.scope')?.name).toBe('Global Scope')
    expect(eventCenterService.listCategories(projectA.id).some((category) => category.id === 'custom.only_b')).toBe(false)
    expect(eventCenterService.listCategories(projectB.id).some((category) => category.id === 'custom.only_b')).toBe(true)

    const eventA = eventCenterService.createEvent({
      projectId: projectA.id,
      categoryId: 'custom.scope',
      title: 'Project A event',
    })
    const eventB = eventCenterService.createEvent({
      projectId: projectB.id,
      categoryId: 'custom.scope',
      title: 'Project B event',
    })

    expect(eventA.priority).toBe('high')
    expect(eventB.priority).toBe('low')
  })

  test('creates an event, creates pending consumption, consumes it, and converts it to a task', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const collector = agentStore.create({ name: '采集 Agent', type: 'research', runtime: 'mock', projectId: project.id })
    const consumer = agentStore.create({ name: '分析 Agent', type: 'pm', runtime: 'mock', projectId: project.id })

    const subscription = eventCenterService.createSubscription({
      projectId: project.id,
      name: '热门项目分析',
      categoryId: 'ai.hot_project',
      consumerAgentId: consumer.id,
      consumerLabel: consumer.name,
      actionMode: 'create_pending',
      filter: { minConfidence: 0.7 },
    })

    const event = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'ai.hot_project',
      title: 'Agent Debug Kit',
      summary: '一个新的 Agent 调试工具正在升温',
      sourceType: 'agent',
      sourceId: collector.id,
      sourceLabel: collector.name,
      priority: 'high',
      confidence: 0.84,
      tags: ['Agent', 'Debug'],
      payload: {
        projectName: 'Agent Debug Kit',
        githubUrl: 'https://github.com/example/agent-debug-kit',
        starsDelta: '+420',
        hotReason: '多个开发者提到工具调用时间线调试能力',
      },
      evidence: [{ title: 'GitHub Trending', url: 'https://github.com/trending' }],
      createdByAgentId: collector.id,
    })

    const consumptions = eventConsumptionStore.listByEvent(event.id)
    expect(consumptions).toHaveLength(1)
    expect(consumptions[0]).toMatchObject({
      event_id: event.id,
      subscription_id: subscription.id,
      consumer_agent_id: consumer.id,
      status: 'pending',
    })

    const claimed = eventCenterService.claimNextEvent({ projectId: project.id, agentId: consumer.id })
    expect(claimed?.event.id).toBe(event.id)
    expect(claimed?.consumption.status).toBe('running')

    const consumed = eventCenterService.consumeEvent({
      consumptionId: claimed!.consumption.id,
      resultSummary: '值得研究，但先进入日报和候选任务池。',
      result: { recommendation: 'watch' },
    })
    expect(consumed.status).toBe('succeeded')
    expect(eventCenterService.getEvent(event.id)?.status).toBe('consumed')

    const task = eventCenterService.convertEventToTask(event.id, {
      title: '调研 Agent Debug Kit',
      description: '从事件中心转入任务',
    })
    expect(task.source).toBe('event')
    expect(task.project_id).toBe(project.id)
    expect(eventCenterService.getEvent(event.id)?.status).toBe('task')
    const taskEvents = eventCenterService.listEvents({ projectId: project.id, categoryId: 'task.lifecycle' })
    expect(taskEvents).toHaveLength(1)
    expect(JSON.parse(taskEvents[0].payload_json)).toMatchObject({
      taskId: task.id,
      taskStatus: 'backlog',
      changeType: 'created',
      source: 'event',
    })
  })

  test('runs the selected consumption instead of the oldest pending event', async () => {
    const enqueuePrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    vi.spyOn(sessionManager, 'sendPrompt').mockResolvedValue(undefined)
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const consumer = agentStore.create({ name: '分析 Agent', type: 'pm', runtime: 'mock', projectId: project.id })

    eventCenterService.createSubscription({
      projectId: project.id,
      name: '热门项目分析',
      categoryId: 'ai.hot_project',
      consumerAgentId: consumer.id,
      consumerLabel: consumer.name,
      actionMode: 'create_pending',
    })
    const first = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'ai.hot_project',
      title: '旧事件',
      confidence: 0.9,
    })
    const second = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'ai.hot_project',
      title: '当前选中事件',
      confidence: 0.9,
    })

    const targetConsumption = eventConsumptionStore.listByEvent(second.id)[0]
    const result = await eventCenterService.runConsumer(targetConsumption.id)

    expect(result.consumption.event_id).toBe(second.id)
    expect(eventConsumptionStore.listByEvent(second.id)[0].status).toBe('running')
    expect(eventConsumptionStore.listByEvent(first.id)[0].status).toBe('pending')
    expect(enqueuePrompt).toHaveBeenCalledWith(result.sessionId, expect.stringContaining(targetConsumption.id), undefined, { contextProjectId: project.id })
  })

  test('reuses the configured existing consumer session', async () => {
    const enqueuePrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    vi.spyOn(sessionManager, 'sendPrompt').mockResolvedValue(undefined)
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const consumer = agentStore.create({ name: 'Consumer', type: 'pm', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: consumer.id, projectId: project.id })

    eventCenterService.createSubscription(subscriptionInput({
      projectId: project.id,
      name: 'Existing session consumer',
      categoryId: 'ai.hot_project',
      consumerAgentId: consumer.id,
      consumerSessionMode: 'existing',
      consumerSessionId: session.id,
    }))
    const event = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'ai.hot_project',
      title: 'Use existing session',
      confidence: 0.9,
    })

    const consumption = eventConsumptionStore.listByEvent(event.id)[0]
    const result = await eventCenterService.runConsumer(consumption.id)

    expect(result.sessionId).toBe(session.id)
    expect(asRecord(eventConsumptionStore.get(consumption.id)).session_id).toBe(session.id)
    expect(enqueuePrompt).toHaveBeenCalledWith(session.id, expect.stringContaining(consumption.id), undefined, { contextProjectId: project.id })
  })

  test('new_fixed consumer sessions are created once and reused', async () => {
    vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    vi.spyOn(sessionManager, 'sendPrompt').mockResolvedValue(undefined)
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const consumer = agentStore.create({ name: 'Consumer', type: 'pm', runtime: 'mock', projectId: project.id })

    const subscription = eventCenterService.createSubscription(subscriptionInput({
      projectId: project.id,
      name: 'Fixed session consumer',
      categoryId: 'ai.hot_project',
      consumerAgentId: consumer.id,
      consumerSessionMode: 'new_fixed',
    }))
    const first = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'ai.hot_project',
      title: 'First fixed event',
      confidence: 0.9,
    })
    const firstResult = await eventCenterService.runConsumer(eventConsumptionStore.listByEvent(first.id)[0].id)
    const storedAfterFirst = eventSubscriptionStore.get(subscription.id)

    const second = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'ai.hot_project',
      title: 'Second fixed event',
      confidence: 0.9,
    })
    const secondResult = await eventCenterService.runConsumer(eventConsumptionStore.listByEvent(second.id)[0].id)

    expect(asRecord(storedAfterFirst).consumer_session_id).toBe(firstResult.sessionId)
    expect(secondResult.sessionId).toBe(firstResult.sessionId)
    expect(asRecord(eventConsumptionStore.listByEvent(first.id)[0]).session_id).toBe(firstResult.sessionId)
    expect(asRecord(eventConsumptionStore.listByEvent(second.id)[0]).session_id).toBe(firstResult.sessionId)
  })

  test('auto_start subscriptions schedule matching consumptions', async () => {
    const enqueuePrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    vi.spyOn(sessionManager, 'sendPrompt').mockResolvedValue(undefined)
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const consumer = agentStore.create({ name: 'Consumer', type: 'pm', runtime: 'mock', projectId: project.id })

    eventCenterService.createSubscription(subscriptionInput({
      projectId: project.id,
      name: 'Auto consumer',
      categoryId: 'ai.hot_project',
      consumerAgentId: consumer.id,
      autoStart: true,
      consumerSessionMode: 'new_fixed',
    }))
    const event = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'ai.hot_project',
      title: 'Auto event',
      confidence: 0.9,
    })

    await waitFor(() => {
      expect(enqueuePrompt).toHaveBeenCalledTimes(1)
      expect(eventConsumptionStore.listByEvent(event.id)[0].status).toBe('running')
    })
  })

  test('updates a subscription and applies the new filter only to future events', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const firstConsumer = agentStore.create({ name: 'First consumer', type: 'pm', runtime: 'mock', projectId: project.id })
    const secondConsumer = agentStore.create({ name: 'Second consumer', type: 'pm', runtime: 'mock', projectId: project.id })

    const subscription = eventCenterService.createSubscription(subscriptionInput({
      projectId: project.id,
      name: 'High priority watcher',
      categoryId: 'ai.hot_project',
      consumerAgentId: firstConsumer.id,
      filter: { priority: 'high' },
    }))
    const highBeforeUpdate = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'ai.hot_project',
      title: 'High before update',
      priority: 'high',
    })
    const lowBeforeUpdate = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'ai.hot_project',
      title: 'Low before update',
      priority: 'low',
    })

    const updated = eventCenterService.updateSubscription(subscription.id, subscriptionInput({
      projectId: project.id,
      name: 'Low priority watcher',
      categoryId: 'ai.hot_project',
      consumerAgentId: secondConsumer.id,
      consumerLabel: secondConsumer.name,
      filter: { priority: 'low' },
      enabled: true,
      autoStart: false,
      consumerSessionMode: 'new_each',
    }))
    const lowAfterUpdate = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'ai.hot_project',
      title: 'Low after update',
      priority: 'low',
    })
    const highAfterUpdate = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'ai.hot_project',
      title: 'High after update',
      priority: 'high',
    })

    expect(updated).toMatchObject({
      id: subscription.id,
      name: 'Low priority watcher',
      consumer_agent_id: secondConsumer.id,
      consumer_label: secondConsumer.name,
    })
    expect(JSON.parse(updated.filter_json)).toEqual({ priority: 'low' })
    expect(eventConsumptionStore.listByEvent(highBeforeUpdate.id).map((item) => item.consumer_agent_id)).toEqual([firstConsumer.id])
    expect(eventConsumptionStore.listByEvent(lowBeforeUpdate.id)).toEqual([])
    expect(eventConsumptionStore.listByEvent(lowAfterUpdate.id).map((item) => item.consumer_agent_id)).toEqual([secondConsumer.id])
    expect(eventConsumptionStore.listByEvent(highAfterUpdate.id)).toEqual([])
  })

  test('deletes a subscription without removing existing consumption history', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const consumer = agentStore.create({ name: 'Consumer', type: 'pm', runtime: 'mock', projectId: project.id })

    const subscription = eventCenterService.createSubscription(subscriptionInput({
      projectId: project.id,
      name: 'Temporary watcher',
      categoryId: 'ai.hot_project',
      consumerAgentId: consumer.id,
      filter: { priority: 'high' },
    }))
    const beforeDelete = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'ai.hot_project',
      title: 'Before delete',
      priority: 'high',
    })

    expect(eventCenterService.deleteSubscription(subscription.id)).toEqual({ subscriptionId: subscription.id, deleted: true })
    const afterDelete = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'ai.hot_project',
      title: 'After delete',
      priority: 'high',
    })

    expect(eventSubscriptionStore.get(subscription.id)).toBeUndefined()
    expect(eventConsumptionStore.listByEvent(beforeDelete.id)).toHaveLength(1)
    expect(eventConsumptionStore.listByEvent(beforeDelete.id)[0].subscription_id).toBe(subscription.id)
    expect(eventConsumptionStore.listByEvent(afterDelete.id)).toEqual([])
  })

  test('matches subscriptions by payload field filters', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const dispatcher = agentStore.create({ name: 'Dispatcher', type: 'pm', runtime: 'mock', projectId: project.id })
    const reviewer = agentStore.create({ name: 'Reviewer', type: 'pm', runtime: 'mock', projectId: project.id })
    const blockedWatcher = agentStore.create({ name: 'Blocked watcher', type: 'pm', runtime: 'mock', projectId: project.id })

    eventCenterService.createSubscription(subscriptionInput({
      projectId: project.id,
      name: 'Unassigned task dispatcher',
      categoryId: 'task.lifecycle',
      consumerAgentId: dispatcher.id,
      filter: { payload: { taskStatus: 'backlog', assignedAgentId: null } },
    }))
    eventCenterService.createSubscription(subscriptionInput({
      projectId: project.id,
      name: 'Review states',
      categoryId: 'task.lifecycle',
      consumerAgentId: reviewer.id,
      filter: { payload: { taskStatus: { in: ['completed', 'cancelled'] } } },
    }))
    eventCenterService.createSubscription(subscriptionInput({
      projectId: project.id,
      name: 'Blocked task has stage',
      categoryId: 'task.lifecycle',
      consumerAgentId: blockedWatcher.id,
      filter: { payload: { taskStatus: 'needs_input', stage: { exists: true } } },
    }))

    const backlog = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'task.lifecycle',
      title: 'Backlog task',
      payload: { taskId: 'task-a', taskStatus: 'backlog', assignedAgentId: null },
    })
    const reviewing = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'task.lifecycle',
      title: 'Reviewing task',
      payload: { taskId: 'task-b', taskStatus: 'completed', assignedAgentId: dispatcher.id },
    })
    const blocked = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'task.lifecycle',
      title: 'Blocked task',
      payload: { taskId: 'task-c', taskStatus: 'needs_input', stage: 'Missing token' },
    })

    expect(eventConsumptionStore.listByEvent(backlog.id).map((item) => item.consumer_agent_id)).toEqual([dispatcher.id])
    expect(eventConsumptionStore.listByEvent(reviewing.id).map((item) => item.consumer_agent_id)).toEqual([reviewer.id])
    expect(eventConsumptionStore.listByEvent(blocked.id).map((item) => item.consumer_agent_id)).toEqual([blockedWatcher.id])
  })

  test('normalizes flat task lifecycle payload filters before matching', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const dispatcher = agentStore.create({ name: 'Dispatcher', type: 'pm', runtime: 'mock', projectId: project.id })

    const subscription = eventCenterService.createSubscription(subscriptionInput({
      projectId: project.id,
      name: 'Flat task backlog filter',
      categoryId: 'task.lifecycle',
      consumerAgentId: dispatcher.id,
      filter: { taskStatus: 'backlog' },
    }))

    expect(JSON.parse(subscription.filter_json)).toEqual({ payload: { taskStatus: 'backlog' } })

    const backlog = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'task.lifecycle',
      title: 'Backlog task',
      payload: { taskId: 'task-a', taskStatus: 'backlog' },
    })
    const executing = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'task.lifecycle',
      title: 'Executing task',
      payload: { taskId: 'task-b', taskStatus: 'executing' },
    })

    expect(eventConsumptionStore.listByEvent(backlog.id).map((item) => item.consumer_agent_id)).toEqual([dispatcher.id])
    expect(eventConsumptionStore.listByEvent(executing.id)).toEqual([])
  })

  test('matches legacy flat task lifecycle subscription filters', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const dispatcher = agentStore.create({ name: 'Dispatcher', type: 'pm', runtime: 'mock', projectId: project.id })
    const subscription = eventSubscriptionStore.create({
      projectId: project.id,
      name: 'Legacy backlog filter',
      categoryId: 'task.lifecycle',
      consumerAgentId: dispatcher.id,
      filter: { taskStatus: 'backlog' },
    })

    const backlog = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'task.lifecycle',
      title: 'Backlog task',
      payload: { taskId: 'task-a', taskStatus: 'backlog' },
    })
    const executing = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'task.lifecycle',
      title: 'Executing task',
      payload: { taskId: 'task-b', taskStatus: 'executing' },
    })

    expect(JSON.parse(subscription.filter_json)).toEqual({ taskStatus: 'backlog' })
    expect(eventConsumptionStore.listByEvent(backlog.id).map((item) => item.consumer_agent_id)).toEqual([dispatcher.id])
    expect(eventConsumptionStore.listByEvent(executing.id)).toEqual([])
  })

  test('skips legacy subscriptions with unknown filter fields', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const dispatcher = agentStore.create({ name: 'Dispatcher', type: 'pm', runtime: 'mock', projectId: project.id })
    eventSubscriptionStore.create({
      projectId: project.id,
      name: 'Legacy bad filter',
      categoryId: 'task.lifecycle',
      consumerAgentId: dispatcher.id,
      filter: { typoStatus: 'backlog' },
    })

    const event = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'task.lifecycle',
      title: 'Backlog task',
      payload: { taskId: 'task-a', taskStatus: 'backlog' },
    })

    expect(eventConsumptionStore.listByEvent(event.id)).toEqual([])
  })

  test('rejects unknown top-level subscription filter fields', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const dispatcher = agentStore.create({ name: 'Dispatcher', type: 'pm', runtime: 'mock', projectId: project.id })

    expect(() => eventCenterService.createSubscription(subscriptionInput({
      projectId: project.id,
      name: 'Bad filter',
      categoryId: 'task.lifecycle',
      consumerAgentId: dispatcher.id,
      filter: { typoStatus: 'backlog' },
    }))).toThrow(/未知订阅过滤字段|unknown subscription filter/i)
  })

  test('rejects non-object payload subscription filters', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const dispatcher = agentStore.create({ name: 'Dispatcher', type: 'pm', runtime: 'mock', projectId: project.id })

    expect(() => eventCenterService.createSubscription(subscriptionInput({
      projectId: project.id,
      name: 'Bad payload filter',
      categoryId: 'task.lifecycle',
      consumerAgentId: dispatcher.id,
      filter: { payload: 'taskStatus=backlog' },
    }))).toThrow(/filter\.payload/)
  })

  test('enforces category writer and consumer allow lists', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const allowedWriter = agentStore.create({ name: 'Writer', type: 'research', runtime: 'mock', projectId: project.id })
    const blockedWriter = agentStore.create({ name: 'Blocked Writer', type: 'research', runtime: 'mock', projectId: project.id })
    const allowedConsumer = agentStore.create({ name: 'Consumer', type: 'pm', runtime: 'mock', projectId: project.id })
    const blockedConsumer = agentStore.create({ name: 'Blocked Consumer', type: 'pm', runtime: 'mock', projectId: project.id })

    eventCenterService.upsertCategory({
      id: 'ai.hot_project',
      name: 'AI hot project',
      allowedWriters: [allowedWriter.id],
      allowedConsumers: [allowedConsumer.id],
    })

    expect(() => eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'ai.hot_project',
      title: 'Blocked event',
      createdByAgentId: blockedWriter.id,
    })).toThrow(/not allowed/i)

    expect(() => eventCenterService.createSubscription({
      projectId: project.id,
      name: 'Blocked subscription',
      categoryId: 'ai.hot_project',
      consumerAgentId: blockedConsumer.id,
    })).toThrow(/not allowed/i)

    eventCenterService.createSubscription({
      projectId: project.id,
      name: 'Allowed subscription',
      categoryId: 'ai.hot_project',
      consumerAgentId: allowedConsumer.id,
    })
    const event = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'ai.hot_project',
      title: 'Allowed event',
      createdByAgentId: allowedWriter.id,
    })

    expect(eventConsumptionStore.listByEvent(event.id).map((item) => item.consumer_agent_id)).toEqual([allowedConsumer.id])
  })

  test('does not let an agent claim events after consumer permission is removed', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const writer = agentStore.create({ name: 'Writer', type: 'research', runtime: 'mock', projectId: project.id })
    const consumer = agentStore.create({ name: 'Consumer', type: 'pm', runtime: 'mock', projectId: project.id })
    const replacement = agentStore.create({ name: 'Replacement', type: 'pm', runtime: 'mock', projectId: project.id })

    eventCenterService.createSubscription({
      projectId: project.id,
      name: 'Allowed subscription',
      categoryId: 'ai.hot_project',
      consumerAgentId: consumer.id,
    })
    const event = eventCenterService.createEvent({
      projectId: project.id,
      categoryId: 'ai.hot_project',
      title: 'Permission can change',
      createdByAgentId: writer.id,
    })

    eventCenterService.upsertCategory({
      id: 'ai.hot_project',
      name: 'AI hot project',
      allowedConsumers: [replacement.id],
    })

    expect(eventCenterService.claimNextEvent({ projectId: project.id, agentId: consumer.id })).toBeNull()
    expect(eventConsumptionStore.listByEvent(event.id)[0].status).toBe('pending')
  })
})

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown
  for (let index = 0; index < 20; index += 1) {
    try {
      assertion()
      return
    } catch (err) {
      lastError = err
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  if (lastError instanceof Error) throw lastError
  throw new Error(String(lastError))
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object')
  return value as Record<string, unknown>
}

function subscriptionInput(input: Parameters<typeof eventCenterService.createSubscription>[0] & Record<string, unknown>): Parameters<typeof eventCenterService.createSubscription>[0] {
  return input
}
