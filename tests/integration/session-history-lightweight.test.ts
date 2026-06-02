import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import { sessionRpcHandlers } from '../../src/gateway/rpc/sessions.js'
import type { RpcContext } from '../../src/gateway/rpc/types.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-history-lightweight-'))
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

describe('session history lightweight tool calls', () => {
  test('sessions.messages keeps latest tool calls and strips older tool calls by default', async () => {
    const session = sessionStore.create({ agentId: 'agent-1' })
    const older = messageStore.append(session.id, {
      role: 'agent',
      content: 'older',
      toolCalls: [{ id: 'tool-old', title: '???', rawOutput: 'x'.repeat(5000) }],
    })
    const latest = messageStore.append(session.id, {
      role: 'agent',
      content: 'latest',
      toolCalls: [{ id: 'tool-latest', title: '????', rawOutput: 'y'.repeat(5000) }],
    })

    const lightweight = await callRpc('sessions.messages', { sessionId: session.id }) as Array<Record<string, unknown>>
    const full = await callRpc('sessions.messages', { sessionId: session.id, includeToolCalls: true }) as Array<Record<string, unknown>>

    expect(lightweight.map((item) => item.id)).toEqual([older.id, latest.id])
    expect(lightweight[0].tool_calls_json).toBeNull()
    expect(lightweight[0].has_tool_calls).toBe(true)
    expect(lightweight[0].tool_call_count).toBe(1)
    expect(lightweight[1].tool_calls_json).toContain('y'.repeat(100))
    expect(lightweight[1].has_tool_calls).toBe(true)
    expect(lightweight[1].tool_call_count).toBe(1)
    expect(full[0].tool_calls_json).toContain('x'.repeat(100))
    expect(full[1].tool_calls_json).toContain('y'.repeat(100))
  })

  test('lazy tool RPC returns summaries and one selected detail', async () => {
    const session = sessionStore.create({ agentId: 'agent-1' })
    const message = messageStore.append(session.id, {
      role: 'agent',
      content: '',
      toolCalls: [
        { id: 'tool-1', title: '小工具', rawOutput: 'small' },
        { id: 'tool-2', title: '大工具', rawOutput: 'y'.repeat(25_000) },
      ],
    })

    const summaries = await callRpc('sessions.messageToolCalls', { sessionId: session.id, messageId: message.id }) as Array<Record<string, unknown>>
    const detail = await callRpc('sessions.messageToolCallDetail', { sessionId: session.id, messageId: message.id, toolCallId: 'tool-2' }) as Record<string, unknown>

    expect(summaries).toHaveLength(2)
    expect(JSON.stringify(summaries)).not.toContain('y'.repeat(1000))
    expect(detail.id).toBe('tool-2')
    expect(String(detail.rawOutputPreview)).toHaveLength(20_000)
    expect(detail.rawOutputTruncated).toBe(true)
    expect(JSON.stringify(detail)).not.toContain('small')
  })

  test('lazy tool RPC rejects messages from another session', async () => {
    const session = sessionStore.create({ agentId: 'agent-1' })
    const otherSession = sessionStore.create({ agentId: 'agent-2' })
    const message = messageStore.append(otherSession.id, {
      role: 'agent',
      content: '',
      toolCalls: [{ id: 'tool-1', title: '工具' }],
    })

    await expect(
      callRpc('sessions.messageToolCalls', { sessionId: session.id, messageId: message.id }),
    ).rejects.toThrow('消息不存在')
  })
})
