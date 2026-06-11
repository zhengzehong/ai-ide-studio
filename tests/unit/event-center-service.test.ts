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
  })

  test('runs the selected consumption instead of the oldest pending event', async () => {
    const sendPrompt = vi.spyOn(sessionManager, 'sendPrompt').mockResolvedValue(undefined)
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
    expect(sendPrompt).toHaveBeenCalledWith(result.sessionId, expect.stringContaining(targetConsumption.id))
  })
})
