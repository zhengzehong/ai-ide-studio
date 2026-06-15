import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { seedBuiltinTools } from '../../src/tools/seed.js'
import { toolStore } from '../../src/store/tools.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import type { ToolContext, ToolHandlerResult } from '../../src/tools/types.js'

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

  test('lets an agent create and partially update event categories through tools', async () => {
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
    })
    const createdCategory = asRecord(created.category)

    expect(createdCategory.id).toBe('custom.alert')
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
    })).rejects.toThrow(/already exists|已存在/i)

    await expect(executeJson('event.category.update', {
      categoryId: 'custom.alert',
      allowedWriters: 'agent-writer',
    })).rejects.toThrow(/allowedWriters/)

    const updated = await executeJson('event.category.update', {
      categoryId: 'custom.alert',
      description: 'Updated category',
      enabled: false,
    })
    const updatedCategory = asRecord(updated.category)

    expect(updatedCategory.name).toBe('Custom Alert')
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
  })

  test('lets an agent create and claim an event through tools', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const collector = agentStore.create({ name: '采集 Agent', type: 'research', runtime: 'mock', projectId: project.id })
    const consumer = agentStore.create({ name: '分析 Agent', type: 'pm', runtime: 'mock', projectId: project.id })

    await executeJson('event.subscription.create', {
      name: '热门项目分析',
      categoryId: 'ai.hot_project',
      consumerAgentId: consumer.id,
      actionMode: 'create_pending',
      filter: { minConfidence: 0.7 },
    }, { projectId: project.id, agentId: collector.id })

    const created = await executeJson('event.create', {
      categoryId: 'ai.hot_project',
      title: 'Agent Debug Kit',
      summary: '新的调试工具',
      confidence: 0.83,
      priority: 'high',
      payload: { projectName: 'Agent Debug Kit', hotReason: '调试时间线' },
    }, { projectId: project.id, agentId: collector.id })
    expect(asRecord(created.event).title).toBe('Agent Debug Kit')

    const claimed = await executeJson('event.claim_next', {}, { projectId: project.id, agentId: consumer.id })
    expect(asRecord(claimed.event).title).toBe('Agent Debug Kit')
    expect(asRecord(claimed.consumption).status).toBe('running')
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
