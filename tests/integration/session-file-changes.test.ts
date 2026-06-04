import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import { sessionRpcHandlers } from '../../src/gateway/rpc/sessions.js'
import type { RpcContext } from '../../src/gateway/rpc/types.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-file-changes-'))
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

describe('session file changes', () => {
  test('messages expose lightweight file-change summaries without loading old tool JSON', async () => {
    const session = sessionStore.create({ agentId: 'agent-1' })
    const older = messageStore.append(session.id, {
      role: 'agent',
      content: 'older',
      toolCalls: [
        {
          id: 'tool-old',
          title: 'Edit file',
          content: [{ type: 'diff', path: 'src/old.ts', oldText: 'a\nb\nc', newText: 'a\nB\nc' }],
          rawOutput: 'x'.repeat(5000),
        },
      ],
    })
    messageStore.append(session.id, {
      role: 'agent',
      content: 'latest',
      toolCalls: [{ id: 'tool-latest', title: 'Read file', locations: [{ path: 'src/read.ts' }] }],
    })

    const messages = await callRpc('sessions.messages', { sessionId: session.id }) as Array<Record<string, unknown>>
    const olderRow = messages.find((item) => item.id === older.id)

    expect(olderRow?.tool_calls_json).toBeNull()
    expect(olderRow?.has_file_changes).toBe(true)
    expect(olderRow?.file_change_count).toBe(1)
    expect(String(olderRow?.file_changes_json)).toContain('src/old.ts')
    expect(String(olderRow?.file_changes_json)).not.toContain('x'.repeat(100))
  })

  test('messageFileChanges returns full detail for one message', async () => {
    const session = sessionStore.create({ agentId: 'agent-1' })
    const message = messageStore.append(session.id, {
      role: 'agent',
      content: 'done',
      toolCalls: [
        {
          id: 'tool-1',
          title: 'Read file',
          locations: [{ path: 'src/read-only.ts' }],
        },
        {
          id: 'tool-2',
          title: 'Edit file',
          content: [{ type: 'diff', path: 'src/app.ts', oldText: 'one\ntwo', newText: 'one\nTWO\nthree' }],
        },
      ],
    })

    const changes = await callRpc('sessions.messageFileChanges', { sessionId: session.id, messageId: message.id }) as Record<string, unknown>

    expect(changes.totalAdded).toBe(2)
    expect(changes.totalDeleted).toBe(1)
    expect(JSON.stringify(changes)).toContain('src/app.ts')
    expect(JSON.stringify(changes)).not.toContain('src/read-only.ts')
  })
})
