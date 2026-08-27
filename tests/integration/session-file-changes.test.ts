import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase, getDb } from '../../src/store/db.js'
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

  test('messages project legacy full diff payloads to file-level summaries', async () => {
    const session = sessionStore.create({ agentId: 'agent-legacy-diff' })
    const message = messageStore.append(session.id, {
      role: 'agent',
      content: 'legacy diff',
    })
    const oldText = 'old line\n'.repeat(2_000)
    const newText = 'new line\n'.repeat(2_000)
    getDb().prepare('UPDATE messages SET file_changes_json = ? WHERE id = ?').run(JSON.stringify({
      files: [{
        path: 'src/legacy.ts',
        changeType: 'M',
        addedLines: 2_000,
        deletedLines: 2_000,
        segments: [{
          toolCallId: 'legacy-tool',
          oldText,
          newText,
          addedLines: 2_000,
          deletedLines: 2_000,
          lines: [{ type: 'del', text: oldText }, { type: 'add', text: newText }],
        }],
      }],
      totalAdded: 2_000,
      totalDeleted: 2_000,
    }), message.id)

    const messages = await callRpc('sessions.messages', { sessionId: session.id }) as Array<Record<string, unknown>>
    const returned = messages.find((item) => item.id === message.id)
    const raw = String(returned?.file_changes_json)

    expect(JSON.parse(raw)).toEqual({
      files: [{ path: 'src/legacy.ts', changeType: 'M', addedLines: 2_000, deletedLines: 2_000 }],
      totalAdded: 2_000,
      totalDeleted: 2_000,
    })
    expect(raw).not.toContain('segments')
    expect(raw).not.toContain('oldText')
    expect(raw.length).toBeLessThan(256)
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

  test('messageFileChanges falls back to the retained file summary after process cleanup', async () => {
    const session = sessionStore.create({ agentId: 'agent-retained-summary' })
    const message = messageStore.append(session.id, {
      role: 'agent',
      content: '历史最终回答',
      fileChangesJson: JSON.stringify({
        files: [{ path: 'src/retained.ts', changeType: 'M', addedLines: 3, deletedLines: 1 }],
        totalAdded: 3,
        totalDeleted: 1,
      }),
    })

    const changes = await callRpc('sessions.messageFileChanges', {
      sessionId: session.id,
      messageId: message.id,
    }) as { files: Array<{ path: string; segments: unknown[] }> }

    expect(changes.files).toEqual([expect.objectContaining({ path: 'src/retained.ts', segments: [] })])
  })

  test('messageFileChanges calculates legacy tool-only details outside the API thread', async () => {
    const session = sessionStore.create({ agentId: 'agent-legacy-tool-detail' })
    const message = messageStore.append(session.id, {
      role: 'agent',
      content: 'legacy tool detail',
    })
    getDb().prepare(`
      UPDATE messages SET tool_calls_json = ?, file_changes_json = NULL WHERE id = ?
    `).run(JSON.stringify([{
      id: 'legacy-edit',
      title: 'Edit file',
      status: 'completed',
      content: [{ type: 'diff', path: 'src/legacy-detail.ts', oldText: 'before', newText: 'after' }],
    }]), message.id)

    const changes = await callRpc('sessions.messageFileChanges', {
      sessionId: session.id,
      messageId: message.id,
    }) as { files: Array<{ path: string; segments: unknown[] }> }

    expect(changes.files).toEqual([
      expect.objectContaining({ path: 'src/legacy-detail.ts', segments: expect.any(Array) }),
    ])
    expect(changes.files[0]?.segments).toHaveLength(1)
  })
})
