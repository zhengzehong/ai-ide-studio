import type * as acp from '@agentclientprotocol/sdk'
import { describe, expect, test } from 'vitest'
import { createAcpRuntimeClient } from '../../src/runtime/service/acp-runtime-client.js'
import type { RuntimeCoalescibleUpdate } from '../../src/runtime/streams/runtime-update-coalescer.js'
import { turnFromEntries, turnFromProcessItems, type TurnEntry } from '../../ui/src/stores/turn-blocks.ts'
import type { TurnProcessItemInfo } from '../../ui/src/stores/session-events.ts'

const id = 'call_95f2a799bb774cdc9f96fc0a'

function heartbeat(index = 0): acp.ToolCallUpdate & { sessionUpdate: 'tool_call_update' } {
  return {
    sessionUpdate: 'tool_call_update',
    toolCallId: `${id}-heartbeat-${index}`,
    status: 'in_progress',
    _meta: { claudeCode: { toolName: 'Bash', toolResponse: { elapsedTimeSeconds: 30 * (index + 1) } } },
  }
}

function fixture(): { router: ReturnType<typeof createAcpRuntimeClient>; updates: RuntimeCoalescibleUpdate[]; send: (update: acp.SessionUpdate, sessionId?: string) => Promise<void> } {
  const updates: RuntimeCoalescibleUpdate[] = []
  const router = createAcpRuntimeClient({
    agentId: 'agent-a',
    publishUpdate: (update) => { updates.push(update) },
    updateCapabilities: () => undefined,
  })
  router.bindSession('session-a', 'acp-a', [])
  router.beginTurn('session-a', 'message-a')
  return { router, updates, send: async (update, sessionId = 'acp-a') => { await router.client.sessionUpdate({ sessionId, update }) } }
}

const call: acp.SessionUpdate = {
  sessionUpdate: 'tool_call', toolCallId: id, title: 'pnpm dist', kind: 'execute',
  status: 'pending', rawInput: { command: 'pnpm dist' },
}

describe('ACP tool heartbeats', () => {
  test('normalizes 13 heartbeats to the original tool and preserves its metadata', async () => {
    const { router, updates, send } = fixture()
    try {
      await send(call)
      for (let i = 0; i < 13; i++) await send(heartbeat(i))
      expect(updates).toHaveLength(14)
      for (const update of updates.slice(1)) {
        expect(update).toMatchObject({ data: { toolCallUpdate: { id, status: 'in_progress' } } })
        if (update.kind === 'session-update') {
          expect(update.data.toolCallUpdate?.title).toBe('pnpm dist')
          expect(update.data.toolCallUpdate?.rawInput).toBeUndefined()
        }
      }
    } finally { router.close() }
  })

  test.each(['completed', 'failed'] as const)('does not revive a %s tool', async (status) => {
    const { router, updates, send } = fixture()
    try {
      await send(call)
      await send({ sessionUpdate: 'tool_call_update', toolCallId: id, status })
      await send(heartbeat())
      expect(updates).toHaveLength(2)
    } finally { router.close() }
  })

  test('drops orphan heartbeats and isolates sessions and turns', async () => {
    const { router, updates, send } = fixture()
    try {
      await send(heartbeat())
      expect(updates).toHaveLength(0)
      await send(call)
      router.bindSession('session-b', 'acp-b', [])
      router.beginTurn('session-b', 'message-b')
      await send(heartbeat(), 'acp-b')
      router.endTurn('session-a')
      router.beginTurn('session-a', 'message-next')
      await send(heartbeat())
      expect(updates).toHaveLength(1)
    } finally { router.close() }
  })

  test('retains heartbeat tracking when the same session is rebound', async () => {
    const { router, updates, send } = fixture()
    try {
      await send(call)
      router.bindSession('session-a', 'acp-a', [])
      await send(heartbeat())
      expect(updates.at(-1)).toMatchObject({ data: { toolCallUpdate: { id, status: 'in_progress' } } })
    } finally { router.close() }
  })

  test('preserves ordinary updates, including similar IDs with real content', async () => {
    const { router, updates, send } = fixture()
    try {
      await send({ ...heartbeat(), _meta: undefined, rawOutput: 'real output' })
      await send({ sessionUpdate: 'tool_call_update', toolCallId: 'early-tool', title: 'Read', status: 'completed' })
      expect(updates).toHaveLength(2)
      expect(updates[0]).toMatchObject({ data: { toolCallUpdate: { id: `${id}-heartbeat-0`, rawOutput: 'real output' } } })
    } finally { router.close() }
  })

  test('honors explicit heartbeat metadata using the original ID', async () => {
    const { router, updates, send } = fixture()
    try {
      await send(call)
      const beat = { ...heartbeat(), toolCallId: id, _meta: { claudeCode: { heartbeat: true } } }
      await send(beat)
      expect(updates.at(-1)).toMatchObject({ data: { toolCallUpdate: { id, title: 'pnpm dist', status: 'in_progress' } } })
      await send({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed' })
      const count = updates.length
      await send(beat)
      expect(updates).toHaveLength(count)
    } finally { router.close() }
  })

  test('does not infer heartbeat solely from an ID suffix', async () => {
    const { router, updates, send } = fixture()
    try {
      await send(call)
      await send({ ...heartbeat(), _meta: undefined })
      expect(updates.at(-1)).toMatchObject({ data: { toolCallUpdate: { id: `${id}-heartbeat-0` } } })
    } finally { router.close() }
  })

  test('an orphan status update is not evidence that a parent tool exists', async () => {
    const { router, updates, send } = fixture()
    try {
      await send({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'in_progress' })
      await send(heartbeat())
      expect(updates).toHaveLength(1)
    } finally { router.close() }
  })

  test('retains an explicitly created real tool whose ID resembles a heartbeat', async () => {
    const { router, updates, send } = fixture()
    try {
      await send(call)
      await send({ ...call, toolCallId: `${id}-heartbeat-0`, title: 'real command' })
      await send(heartbeat())
      expect(updates.at(-1)).toMatchObject({ data: { toolCallUpdate: { id: `${id}-heartbeat-0` } } })
    } finally { router.close() }
  })
})

const original: TurnEntry = { kind: 'toolCall', toolCall: { id, title: 'pnpm dist', status: 'completed' } }
const legacy: TurnEntry = { kind: 'toolUpdate', toolCall: { id: `${id}-heartbeat-0`, title: '工具调用 #beat-0', status: 'in_progress' } }

describe('legacy heartbeat history', () => {
  test('hides confirmed placeholders without changing parent completion or final reply', () => {
    const turn = turnFromEntries('message-a', [original, legacy, { kind: 'reply', text: 'Done' }])
    expect(turn.processBlocks).toHaveLength(1)
    expect(turn.toolCalls).toEqual([original.toolCall])
    expect(turn.finalAnswer).toBe('Done')
  })

  test('keeps unconfirmed placeholders when the parent is missing', () => {
    expect(turnFromEntries('message-a', [legacy]).toolCalls).toHaveLength(1)
  })

  test('preserves genuine tools with similar names or IDs', () => {
    const real: TurnEntry = { kind: 'toolUpdate', toolCall: { ...legacy.toolCall, title: 'Bash', rawInput: { command: 'echo ok' } } }
    expect(turnFromEntries('message-a', [original, real]).toolCalls).toHaveLength(2)
  })

  test('filters an older orphan only after its actual parent is loaded', () => {
    const turn = turnFromEntries('message-a', [legacy, original])
    expect(turn.toolCalls).toEqual([original.toolCall])
  })

  test('filters process-item summaries without requiring a detail fetch', () => {
    const item = (tool: typeof original.toolCall, sequence: number): TurnProcessItemInfo => ({
      id: `item-${sequence}`, session_id: 'session-a', message_id: 'message-a',
      kind: 'tool', sequence, title: tool.title, status: tool.status ?? null,
      summary: tool.title, preview: null, content: null, detail_json: null,
      meta_json: JSON.stringify({ toolCallId: tool.id }), has_detail: false,
      created_at: '', updated_at: '',
    })
    const turn = turnFromProcessItems('message-a', [item(original.toolCall, 1), item(legacy.toolCall, 2)])
    expect(turn.toolCalls).toEqual([original.toolCall])
  })
})
