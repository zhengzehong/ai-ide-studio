import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import { stableProcessItemId, turnProcessItemStore } from '../../src/store/turn-process-items.js'
import { sessionRpcHandlers } from '../../src/gateway/rpc/sessions.js'
import type { RpcContext } from '../../src/gateway/rpc/types.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-turn-process-items-'))
let dbIndex = 0

beforeEach(() => {
  closeDatabase()
  const dbDir = resolve(tmp, `case-${++dbIndex}`)
  mkdirSync(dbDir, { recursive: true })
  initDatabase(resolve(dbDir, 'test.sqlite'))
})

afterAll(() => { closeDatabase(); rmSync(tmp, { recursive: true, force: true }) })

async function callRpc(type: keyof typeof sessionRpcHandlers, msg: Record<string, unknown>): Promise<unknown> {
  let result: unknown
  const context: RpcContext = {
    state: { subscriptions: new Set() },
    sendResult: (data) => { result = data },
    sendError: (message) => { throw new Error(message) },
    sendOutOfBandError: (message) => { throw new Error(message) },
  }
  await sessionRpcHandlers[type]({ type, ...msg }, context)
  return result
}

describe('turn process items', () => {
  test('stores plan and file changes as recoverable process items', async () => {
    const session = sessionStore.create({ agentId: 'agent-1' })
    const message = messageStore.append(session.id, {
      id: 'msg-agent-running',
      role: 'agent',
      content: '',
      status: 'running',
      startedAt: '2026-06-05T00:00:00.000Z',
    })

    turnProcessItemStore.upsert({
      id: stableProcessItemId(message.id, 'stage', 'current'),
      sessionId: session.id,
      messageId: message.id,
      kind: 'stage',
      status: 'completed',
      title: '状态',
      summary: '正在准备',
      content: '正在准备',
    })

    turnProcessItemStore.upsert({
      id: stableProcessItemId(message.id, 'plan', 'current'),
      sessionId: session.id,
      messageId: message.id,
      kind: 'plan',
      status: 'running',
      title: '计划',
      summary: '计划 2 项',
      content: JSON.stringify({ plan: [{ content: '检查现状', status: 'completed', priority: 'medium' }, { content: '实现修复', status: 'in_progress', priority: 'high' }] }),
      detail: { plan: [{ content: '检查现状', status: 'completed', priority: 'medium' }, { content: '实现修复', status: 'in_progress', priority: 'high' }] },
    })

    turnProcessItemStore.upsert({
      id: stableProcessItemId(message.id, 'file_change', 'tool-1'),
      sessionId: session.id,
      messageId: message.id,
      kind: 'file_change',
      status: 'completed',
      title: '文件修改',
      summary: '修改 1 个文件，+1 -1',
      detail: {
        files: [{
          path: 'src/app.ts',
          changeType: 'M',
          addedLines: 1,
          deletedLines: 1,
          segments: [{ toolCallId: 'tool-1', oldText: 'a', newText: 'b', addedLines: 1, deletedLines: 1, lines: [] }],
        }],
        totalAdded: 1,
        totalDeleted: 1,
      },
    })

    const processItems = await callRpc('sessions.messageProcess', { sessionId: session.id, messageId: message.id }) as Array<Record<string, unknown>>
    expect(processItems.map((item) => item.kind)).toEqual(['stage', 'plan', 'file_change'])
    expect(processItems.every((item) => item.detail_json == null)).toBe(true)
    expect(processItems.map((item) => item.has_detail)).toEqual([false, true, true])
    expect(JSON.stringify(processItems[1]?.content)).toContain('检查现状')
    expect(messageStore.get(message.id)?.process_item_count).toBe(2)

    const changes = await callRpc('sessions.messageFileChanges', { sessionId: session.id, messageId: message.id }) as Record<string, unknown>
    expect(changes.totalAdded).toBe(1)
    expect(JSON.stringify(changes)).toContain('src/app.ts')
  })
})
