import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { eventConsumptionStore } from '../../src/store/event-consumptions.js'
import { dispatchRpc } from '../../src/gateway/rpc/registry.js'
import type { ClientMessage } from '../../src/types/ws-protocol.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-event-rpc-'))
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('event center RPC', () => {
  test('creates subscriptions and events through RPC', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const consumer = agentStore.create({ name: '分析 Agent', type: 'pm', runtime: 'mock', projectId: project.id })
    const rpc = createRpc()

    await rpc.send({
      type: 'eventSubscriptions.create',
      name: '热门项目分析',
      projectId: project.id,
      categoryId: 'ai.hot_project',
      consumerAgentId: consumer.id,
      actionMode: 'create_pending',
      filter: { minConfidence: 0.7 },
    })
    expect(rpc.last().type).toBe('result')

    await rpc.send({
      type: 'events.create',
      projectId: project.id,
      categoryId: 'ai.hot_project',
      title: 'Agent Debug Kit',
      summary: '新的调试工具',
      priority: 'high',
      confidence: 0.9,
      payload: { projectName: 'Agent Debug Kit' },
    })

    const response = rpc.last()
    expect(response.type).toBe('result')
    expect(asRecord(response.data).title).toBe('Agent Debug Kit')
    expect(eventConsumptionStore.listByEvent(asRecord(response.data).id as string)).toHaveLength(1)

    await rpc.send({ type: 'events.list', projectId: project.id })
    expect(asRecords(rpc.last().data)).toHaveLength(1)
  })

  test('paginates event list when limit is provided', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const rpc = createRpc()

    for (const title of ['Alpha Agent', 'Beta Agent', 'Gamma Tool']) {
      await rpc.send({
        type: 'events.create',
        projectId: project.id,
        categoryId: 'ai.hot_project',
        title,
        confidence: 0.9,
      })
    }

    await rpc.send({
      type: 'events.list',
      projectId: project.id,
      keyword: 'Agent',
      limit: 1,
      offset: 1,
    })

    const page = asRecord(rpc.last().data)
    expect(page.total).toBe(2)
    expect(page.limit).toBe(1)
    expect(page.offset).toBe(1)
    expect(asRecords(page.items)).toHaveLength(1)
    expect(asRecords(page.items)[0].title).toContain('Agent')
  })
})

function createRpc(): {
  send: (msg: ClientMessage) => Promise<void>
  last: () => { type?: string; data?: unknown; message?: string }
} {
  const sent: Array<{ type?: string; data?: unknown; message?: string }> = []
  return {
    async send(msg) {
      await dispatchRpc(msg, {
        state: { subscriptions: new Set() },
        sendResult: (data) => sent.push({ type: 'result', data }),
        sendError: (message) => sent.push({ type: 'error', message }),
        sendOutOfBandError: (message) => sent.push({ type: 'error', message }),
      })
    },
    last: () => sent.at(-1) ?? {},
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object')
  return value as Record<string, unknown>
}

function asRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('expected array')
  return value.map(asRecord)
}
