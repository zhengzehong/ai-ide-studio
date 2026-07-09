import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import { stableProcessItemId, turnProcessItemStore } from '../../src/store/turn-process-items.js'
import { sessionRpcHandlers } from '../../src/gateway/rpc/sessions.js'
import { completeTurnProcess, recordTurnProcessUpdate, startTurnProcess } from '../../src/core/turn-process-runtime.js'
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

  test('keeps meaningful tool title when later process updates only have generic numbered titles', async () => {
    const session = sessionStore.create({ agentId: 'agent-1' })
    const message = messageStore.append(session.id, {
      id: 'msg-agent-running',
      role: 'agent',
      content: '',
      status: 'running',
      startedAt: '2026-06-05T00:00:00.000Z',
    })
    const itemId = stableProcessItemId(message.id, 'tool', 'tool-1')

    startTurnProcess(session.id, message.id)
    recordTurnProcessUpdate(session.id, 'agent-1', {
      messageId: message.id,
      role: 'agent',
      toolCall: {
        id: 'tool-1',
        title: "Get-Content -Path 'README.md'",
        kind: 'execute',
        status: 'in_progress',
        rawInput: { command: "Get-Content -Path 'README.md'", cwd: 'D:\\code_space\\python_space\\ai-ide-studio' },
      },
    })
    recordTurnProcessUpdate(session.id, 'agent-1', {
      messageId: message.id,
      role: 'agent',
      toolCallUpdate: {
        id: 'tool-1',
        title: '工具调用 #abc123',
        status: 'completed',
        rawOutput: { formatted_output: 'README content', exit_code: 0 },
      },
    })

    const stored = turnProcessItemStore.detail(message.id, itemId)
    const detail = JSON.parse(stored?.detail_json as string) as Record<string, unknown>

    expect(stored?.title).toBe("Get-Content -Path 'README.md'")
    expect(stored?.summary).toBe("Get-Content -Path 'README.md' · completed")
    expect(detail.title).toBe("Get-Content -Path 'README.md'")
    expect(detail.rawInput).toEqual({ command: "Get-Content -Path 'README.md'", cwd: 'D:\\code_space\\python_space\\ai-ide-studio' })
    expect(detail.rawOutput).toEqual({ formatted_output: 'README content', exit_code: 0 })
  })

  test('coalesces running message snapshot writes while streaming text', () => {
    vi.useFakeTimers()
    try {
      const session = sessionStore.create({ agentId: 'agent-1' })
      const message = messageStore.append(session.id, {
        id: 'msg-agent-running',
        role: 'agent',
        content: '',
        status: 'running',
        startedAt: '2026-06-05T00:00:00.000Z',
      })

      startTurnProcess(session.id, message.id)
      recordTurnProcessUpdate(session.id, 'agent-1', {
        messageId: message.id,
        role: 'agent',
        contentDelta: 'A',
      })
      recordTurnProcessUpdate(session.id, 'agent-1', {
        messageId: message.id,
        role: 'agent',
        contentDelta: 'B',
      })

      expect(messageStore.get(message.id)?.content).toBe('')

      vi.advanceTimersByTime(500)
      expect(messageStore.get(message.id)?.content).toBe('AB')

      recordTurnProcessUpdate(session.id, 'agent-1', {
        messageId: message.id,
        role: 'agent',
        contentDelta: 'C',
      })
      expect(messageStore.get(message.id)?.content).toBe('AB')

      const completed = completeTurnProcess(session.id, 'completed')
      expect(completed.finalAnswer).toBe('ABC')
      expect(messageStore.get(message.id)?.content).toBe('ABC')
    } finally {
      vi.useRealTimers()
    }
  })

  test('coalesces thinking process item writes while streaming text', () => {
    vi.useFakeTimers()
    try {
      const session = sessionStore.create({ agentId: 'agent-1' })
      const message = messageStore.append(session.id, {
        id: 'msg-agent-running',
        role: 'agent',
        content: '',
        status: 'running',
        startedAt: '2026-06-05T00:00:00.000Z',
      })

      startTurnProcess(session.id, message.id)
      recordTurnProcessUpdate(session.id, 'agent-1', {
        messageId: message.id,
        role: 'agent',
        thinking: 'A',
      })
      recordTurnProcessUpdate(session.id, 'agent-1', {
        messageId: message.id,
        role: 'agent',
        thinking: 'B',
      })

      expect(turnProcessItemStore.list(message.id)).toEqual([])

      vi.advanceTimersByTime(300)
      const items = turnProcessItemStore.list(message.id)
      expect(items).toHaveLength(1)
      expect(items[0].kind).toBe('thinking')
      expect(items[0].content).toBe('AB')

      recordTurnProcessUpdate(session.id, 'agent-1', {
        messageId: message.id,
        role: 'agent',
        thinking: 'C',
      })

      const completed = completeTurnProcess(session.id, 'completed')
      expect(completed.messageId).toBe(message.id)
      expect(turnProcessItemStore.list(message.id)[0].content).toBe('ABC')
    } finally {
      vi.useRealTimers()
    }
  })

  test('clears running snapshot when streamed text is demoted to a process note', () => {
    const session = sessionStore.create({ agentId: 'agent-1' })
    const message = messageStore.append(session.id, {
      id: 'msg-agent-running',
      role: 'agent',
      content: '',
      status: 'running',
      startedAt: '2026-06-05T00:00:00.000Z',
    })

    startTurnProcess(session.id, message.id)
    recordTurnProcessUpdate(session.id, 'agent-1', {
      messageId: message.id,
      role: 'agent',
      contentDelta: 'I will inspect first',
    })
    recordTurnProcessUpdate(session.id, 'agent-1', {
      messageId: message.id,
      role: 'agent',
      toolCall: { id: 'tool-1', title: 'read file', status: 'completed' },
    })

    expect(messageStore.get(message.id)?.content).toBe('')
  })
})
