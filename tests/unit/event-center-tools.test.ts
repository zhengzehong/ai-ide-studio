import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { seedBuiltinTools } from '../../src/tools/seed.js'
import { toolStore } from '../../src/store/tools.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import type { ToolContext, ToolHandlerResult } from '../../src/tools/types.js'
import { sessionStore } from '../../src/store/sessions.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-event-tools-'))
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('event center MCP tools', () => {
  test('seeds event tools as builtin platform tools', () => {
    seedBuiltinTools()
    const names = toolStore.list().map((tool) => tool.name)

    expect(names).toEqual(expect.arrayContaining([
      'event.category.list',
      'event.category.create',
      'event.category.update',
      'event.create',
      'event.list',
      'event.get',
      'event.claim_next',
      'event.consume',
      'event.convert_to_task',
      'event.ignore',
    ]))
  })

  test('lets an agent create and partially update project event categories through tools', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })

    const created = await executeJson('event.category.create', {
      categoryId: 'custom.alert',
      name: 'Custom Alert',
      description: 'Initial category',
      schema: {
        type: 'object',
        properties: {
          severity: { type: 'string' },
        },
      },
      defaultPriority: 'high',
      allowedWriters: ['agent-writer'],
      allowedConsumers: ['agent-consumer'],
    }, { projectId: project.id })
    const createdCategory = asRecord(created.category)

    expect(createdCategory.id).toBe('custom.alert')
    expect(createdCategory.project_id).toBe(project.id)
    expect(JSON.parse(createdCategory.schema_json as string)).toEqual({
      type: 'object',
      properties: {
        severity: { type: 'string' },
      },
    })
    expect(JSON.parse(createdCategory.allowed_writers_json as string)).toEqual(['agent-writer'])
    expect(JSON.parse(createdCategory.allowed_consumers_json as string)).toEqual(['agent-consumer'])

    await expect(executeJson('event.category.create', {
      categoryId: 'custom.alert',
      name: 'Duplicate',
    }, { projectId: project.id })).rejects.toThrow(/already exists|exists/i)

    await expect(executeJson('event.category.update', {
      categoryId: 'custom.alert',
      allowedWriters: 'agent-writer',
    }, { projectId: project.id })).rejects.toThrow(/allowedWriters/)

    const updated = await executeJson('event.category.update', {
      categoryId: 'custom.alert',
      description: 'Updated category',
      enabled: false,
    }, { projectId: project.id })
    const updatedCategory = asRecord(updated.category)

    expect(updatedCategory.name).toBe('Custom Alert')
    expect(updatedCategory.project_id).toBe(project.id)
    expect(updatedCategory.description).toBe('Updated category')
    expect(updatedCategory.default_priority).toBe('high')
    expect(updatedCategory.enabled).toBe(0)
    expect(JSON.parse(updatedCategory.schema_json as string)).toEqual({
      type: 'object',
      properties: {
        severity: { type: 'string' },
      },
    })
    expect(JSON.parse(updatedCategory.allowed_writers_json as string)).toEqual(['agent-writer'])
    expect(JSON.parse(updatedCategory.allowed_consumers_json as string)).toEqual(['agent-consumer'])

    const globalList = await executeJson('event.category.list', {})
    expect(asRecords(globalList.categories).some((category) => category.id === 'custom.alert')).toBe(false)

    await executeJson('event.category.update', {
      categoryId: 'custom.alert',
      enabled: true,
    }, { projectId: project.id })
    const projectList = await executeJson('event.category.list', {}, { projectId: project.id })
    expect(asRecords(projectList.categories).some((category) => category.id === 'custom.alert')).toBe(true)
  })

  test('lets project tools override an existing global category id without changing the global category', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })

    await executeJson('event.category.create', {
      categoryId: 'custom.shared',
      name: 'Global Shared',
      defaultPriority: 'low',
    })

    await executeJson('event.category.create', {
      categoryId: 'custom.shared',
      name: 'Project Shared',
      defaultPriority: 'high',
    }, { projectId: project.id })

    const globalList = await executeJson('event.category.list', {})
    const projectList = await executeJson('event.category.list', {}, { projectId: project.id })

    expect(asRecords(globalList.categories).find((category) => category.id === 'custom.shared')?.name).toBe('Global Shared')
    expect(asRecords(projectList.categories).find((category) => category.id === 'custom.shared')?.name).toBe('Project Shared')
  })

  test('lets an agent create and claim an event through tools', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const collector = agentStore.create({ name: 'Collector Agent', type: 'research', runtime: 'mock', projectId: project.id })
    const consumer = agentStore.create({ name: 'Consumer Agent', type: 'pm', runtime: 'mock', projectId: project.id })

    await executeJson('event.subscription.create', {
      name: 'Hot project analysis',
      categoryId: 'ai.hot_project',
      consumerAgentId: consumer.id,
      actionMode: 'create_pending',
      filter: { minConfidence: 0.7 },
    }, { projectId: project.id, agentId: collector.id })

    const created = await executeJson('event.create', {
      categoryId: 'ai.hot_project',
      title: 'Agent Debug Kit',
      summary: 'New debugging tool',
      confidence: 0.83,
      priority: 'high',
      payload: { projectName: 'Agent Debug Kit', hotReason: 'Debug timeline' },
    }, { projectId: project.id, agentId: collector.id })
    expect(asRecord(created.event).title).toBe('Agent Debug Kit')

    const claimed = await executeJson('event.claim_next', {}, { projectId: project.id, agentId: consumer.id })
    expect(asRecord(claimed.event).title).toBe('Agent Debug Kit')
    expect(asRecord(claimed.consumption).status).toBe('running')
  })

  test('lets an agent create an auto subscription with a consumer session strategy', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const collector = agentStore.create({ name: 'Collector', type: 'research', runtime: 'mock', projectId: project.id })
    const consumer = agentStore.create({ name: 'Consumer', type: 'pm', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: consumer.id, projectId: project.id })

    const result = await executeJson('event.subscription.create', {
      name: 'Auto existing session consumer',
      categoryId: 'ai.hot_project',
      consumerAgentId: consumer.id,
      autoStart: true,
      consumerSessionMode: 'existing',
      consumerSessionId: session.id,
    }, { projectId: project.id, agentId: collector.id })

    const subscription = asRecord(result.subscription)
    expect(subscription.auto_start).toBe(1)
    expect(subscription.consumer_session_mode).toBe('existing')
    expect(subscription.consumer_session_id).toBe(session.id)
  })

  test('normalizes flat payload filters passed through subscription tool', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const collector = agentStore.create({ name: 'Collector', type: 'research', runtime: 'mock', projectId: project.id })
    const consumer = agentStore.create({ name: 'Consumer', type: 'pm', runtime: 'mock', projectId: project.id })

    const result = await executeJson('event.subscription.create', {
      name: 'Backlog dispatcher',
      categoryId: 'task.lifecycle',
      consumerAgentId: consumer.id,
      filter: { taskStatus: 'backlog' },
    }, { projectId: project.id, agentId: collector.id })

    const subscription = asRecord(result.subscription)
    expect(JSON.parse(subscription.filter_json as string)).toEqual({ payload: { taskStatus: 'backlog' } })
  })
})

async function executeJson(
  handlerName: string,
  input: Record<string, unknown>,
  context: ToolContext = {},
): Promise<Record<string, unknown>> {
  const handler = getHandler(handlerName)
  if (!handler) throw new Error(`handler missing: ${handlerName}`)
  const result: ToolHandlerResult = await handler.execute(input, context)
  expect(result.isError).not.toBe(true)
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object')
  return value as Record<string, unknown>
}

function asRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('expected array')
  return value.map(asRecord)
}
