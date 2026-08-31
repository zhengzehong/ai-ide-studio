import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { dispatchRpc } from '../../src/gateway/rpc/registry.js'
import type { RpcClientState } from '../../src/gateway/rpc/types.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { readingItemStore } from '../../src/store/reading-items.js'
import { sessionStore } from '../../src/store/sessions.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-reading-rpc-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('reading RPC', () => {
  test('lists active entries with source labels, filters, counts, and no filesystem paths', async () => {
    const first = createSource('绿色项目', '#059669', 'Agent A', '来源会话 A')
    const second = createSource('蓝色项目', '#2563eb', 'Agent B', '来源会话 B')
    const markdown = readingItemStore.create({
      ...first,
      title: 'Rust Agent Loop',
      summary: '工具调用和上下文管理',
      format: 'md',
      mountPath: resolve(tmp, 'docs'),
      entryFile: 'guide.md',
    })
    readingItemStore.create({
      ...second,
      title: 'HTML 教程',
      summary: '浏览器布局',
      format: 'url',
      url: 'https://example.com/tutorial',
    })

    const all = await request('reading.list', {}) as ReadingListResult
    expect(all.items).toHaveLength(2)
    expect(all.unreadCount).toBe(2)
    expect(all.projectCounts).toEqual(expect.arrayContaining([
      { projectId: first.projectId, projectName: '绿色项目', projectColor: '#059669', count: 1 },
      { projectId: second.projectId, projectName: '蓝色项目', projectColor: '#2563eb', count: 1 },
    ]))
    expect(all.items.find((item) => item.id === markdown.id)).toMatchObject({
      projectName: '绿色项目',
      projectColor: '#059669',
      agentName: 'Agent A',
      sessionTitle: '来源会话 A',
      contentUrl: expect.stringContaining(`/reading/${markdown.id}/`),
      externalUrl: null,
    })
    expect(JSON.stringify(all.items)).not.toContain(resolve(tmp, 'docs'))

    const filtered = await request('reading.list', { projectId: first.projectId, query: '上下文' }) as ReadingListResult
    expect(filtered.items.map((item) => item.id)).toEqual([markdown.id])
  })

  test('gets an item and changes unread/read/archived state', async () => {
    const source = createSource('项目', null, 'Agent', '来源会话')
    const item = readingItemStore.create({
      ...source,
      title: '外部文档',
      format: 'url',
      url: 'https://example.com/docs',
    })

    const detail = await request('reading.get', { readingId: item.id }) as { item: ReadingDto }
    expect(detail.item).toMatchObject({ id: item.id, status: 'unread', externalUrl: 'https://example.com/docs', contentUrl: null })

    await request('reading.update', { readingId: item.id, status: 'read' })
    expect(readingItemStore.get(item.id)).toMatchObject({ status: 'read', read_at: expect.any(String), archived_at: null })

    await request('reading.update', { readingId: item.id, status: 'archived' })
    expect(readingItemStore.get(item.id)).toMatchObject({ status: 'archived', archived_at: expect.any(String) })
    const archived = await request('reading.list', { status: 'archived' }) as ReadingListResult
    expect(archived.items.map((entry) => entry.id)).toEqual([item.id])

    await request('reading.update', { readingId: item.id, status: 'read' })
    expect(readingItemStore.get(item.id)).toMatchObject({ status: 'read', archived_at: null })
  })

  test('keeps global reading data owner-only', async () => {
    const errors: string[] = []
    await dispatchRpc({ type: 'reading.list' }, {
      state: { subscriptions: new Set(), authMode: 'guest' },
      sendResult: () => { throw new Error('guest must not receive reading data') },
      sendError: (message) => errors.push(message),
      sendOutOfBandError: (message) => errors.push(message),
    })
    expect(errors).toEqual(['阅读功能仅限所有者使用'])
  })
})

interface ReadingDto {
  id: string
  status: string
  projectName: string | null
  projectColor: string | null
  agentName: string | null
  sessionTitle: string | null
  contentUrl: string | null
  externalUrl: string | null
}

interface ReadingListResult {
  items: ReadingDto[]
  unreadCount: number
  projectCounts: Array<{ projectId: string | null; projectName: string | null; projectColor: string | null; count: number }>
}

function createSource(projectName: string, color: string | null, agentName: string, sessionTitle: string) {
  const project = projectStore.create({ name: projectName, workDir: tmp, color: color ?? undefined })
  const agent = agentStore.create({ type: 'developer', name: agentName, runtime: 'codex', projectId: project.id })
  const session = sessionStore.create({ agentId: agent.id, projectId: project.id, title: sessionTitle })
  return { projectId: project.id, agentId: agent.id, sessionId: session.id }
}

async function request(type: string, fields: Record<string, unknown>): Promise<unknown> {
  const results: unknown[] = []
  const errors: string[] = []
  const state: RpcClientState = { subscriptions: new Set(), authMode: 'owner' }
  await dispatchRpc({ type, ...fields }, {
    state,
    sendResult: (data) => results.push(data),
    sendError: (message) => errors.push(message),
    sendOutOfBandError: (message) => errors.push(message),
  })
  expect(errors).toEqual([])
  expect(results).toHaveLength(1)
  return results[0]
}
