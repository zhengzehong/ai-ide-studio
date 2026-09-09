import { describe, expect, it } from 'vitest'
import { aggregateSnapshots, applyEventToSnapshot, emptySnapshot, updateStreaming, type Snapshot } from '../../ui/src/components/team/TeamChatPane'
import { defaultCaps } from '../../ui/src/stores/session-events'

function message(id: string, role: string, content: string) {
  return { id, session_id: 'team', role, content, thinking: null, tool_calls_json: null, decision_json: null, timestamp: '2026-09-09T00:00:00.000Z' }
}

function event(id: string, type: string, payload: Record<string, unknown>) {
  return { id, session_id: 's1', message_id: typeof payload.messageId === 'string' ? payload.messageId : null, sequence: Number(id.slice(1)), type, payload_json: JSON.stringify(payload), created_at: '2026-09-09T00:00:00.000Z' }
}

describe('team chat aggregation', () => {
  it('deduplicates Master when the conversation member list includes Master', () => {
    const snapshot = { ...emptySnapshot('s1'), messages: [message('s1:m1', 'human', '你好')] }
    const result = aggregateSnapshots({ s1: snapshot }, ['s1', 's1'], 's1')
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.content).toBe('你好')
  })

  it('keeps one live turn per member and preserves sequential chunks', () => {
    const first = updateStreaming({}, 's1', { messageId: 'm1', contentDelta: 'A' })
    const second = updateStreaming(first, 's1', { messageId: 'm1', contentDelta: 'B' })
    const result = aggregateSnapshots(second, ['s1', 's1'], 's1')
    expect(result.streaming).toHaveLength(1)
    expect(result.streaming[0]?.content).toBe('AB')
  })

  it('does not rewrite a live turn id when a usage event arrives', () => {
    const state = updateStreaming({}, 's1', { messageId: 'm1', contentDelta: 'A' })
    const afterUsage = applyEventToSnapshot(state, 's1', event('e1', 'usage.update', { usage: { contextSize: 10, contextUsed: 1 } }), 'team')
    expect(afterUsage.s1?.streaming?.id).toBe('m1')
  })

  it('is idempotent when the same persisted event is delivered twice', () => {
    const initial: Record<string, Snapshot> = { s1: { ...emptySnapshot('s1'), capabilities: { ...defaultCaps } } }
    const incoming = event('e1', 'message.chunk', { role: 'agent', messageId: 'm1', contentDelta: 'A' })
    const once = applyEventToSnapshot(initial, 's1', incoming, 'team')
    const twice = applyEventToSnapshot(once, 's1', incoming, 'team')
    expect(twice.s1?.events).toHaveLength(1)
    expect(twice.s1?.streaming?.content).toBe('A')
  })
})
