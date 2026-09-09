import { describe, expect, it } from 'vitest'
import { aggregateSnapshots, applyEventToSnapshot, emptySnapshot, finalizeSnapshot, mergeLoadedSnapshots, updateStreaming, type Snapshot } from '../../ui/src/components/team/TeamChatPane'
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

  it('keeps the final reply when message.done clears the live turn before session.done', () => {
    const live = updateStreaming({}, 's1', { messageId: 'm1', contentDelta: '最终回复' })
    const done = event('e2', 'message.done', { messageId: 'm1', turnUsage: { outputTokens: 3 } })
    const completed = applyEventToSnapshot(live, 's1', done, 'team')
    expect(completed.s1?.streaming).toBeNull()
    expect(completed.s1?.running).toBe(false)
    expect(completed.s1?.messages).toHaveLength(1)
    expect(completed.s1?.messages[0]?.content).toBe('最终回复')
    expect(completed.s1?.messages[0]?.decision_json).toContain('outputTokens')
    expect(completed.s1?.messages[0]?.session_id).toBe('team')
  })

  it('is idempotent when the same persisted event is delivered twice', () => {
    const initial: Record<string, Snapshot> = { s1: { ...emptySnapshot('s1'), capabilities: { ...defaultCaps } } }
    const incoming = event('e1', 'message.chunk', { role: 'agent', messageId: 'm1', contentDelta: 'A' })
    const once = applyEventToSnapshot(initial, 's1', incoming, 'team')
    const twice = applyEventToSnapshot(once, 's1', incoming, 'team')
    expect(twice.s1?.events).toHaveLength(1)
    expect(twice.s1?.streaming?.content).toBe('A')
  })

  it('promotes a live turn to a completed message before history persistence catches up', () => {
    const live = updateStreaming({}, 's1', { messageId: 'm1', contentDelta: '最终回复' })
    const completed = finalizeSnapshot(live, 's1', 'm1', 'master-1')
    expect(completed.s1?.streaming).toBeNull()
    expect(completed.s1?.running).toBe(false)
    expect(completed.s1?.messages).toHaveLength(1)
    expect(completed.s1?.messages[0]?.content).toBe('最终回复')
    expect(completed.s1?.messages[0]?.session_id).toBe('master-1')
  })

  it('does not erase the completed message when done reload returns an empty page', () => {
    const live = updateStreaming({}, 's1', { messageId: 'm1', contentDelta: '保留这条消息' })
    const completed = finalizeSnapshot(live, 's1', 'm1')
    const stale = { s1: { ...emptySnapshot('s1'), capabilities: { ...defaultCaps } } }
    const merged = mergeLoadedSnapshots(completed, stale)
    expect(merged.s1?.messages).toHaveLength(1)
    expect(merged.s1?.messages[0]?.content).toBe('保留这条消息')
  })

  it('does not replace a locally completed turn with a stale running history snapshot', () => {
    const live = updateStreaming({}, 's1', { messageId: 'm1', contentDelta: '本地完整回复' })
    const completed = finalizeSnapshot(live, 's1', 'm1', 'master-1')
    const stale: Record<string, Snapshot> = {
      s1: {
        ...emptySnapshot('s1'),
        messages: [{ ...message('s1:m1', 'agent', ''), status: 'running' }],
      },
    }
    stale.s1.streaming = { id: 'm1', role: 'agent', content: '', finalAnswer: '', thinking: '', processBlocks: [], toolCalls: [], done: false }
    stale.s1.running = true
    const merged = mergeLoadedSnapshots(completed, stale)
    expect(merged.s1?.streaming).toBeNull()
    expect(merged.s1?.running).toBe(false)
    expect(merged.s1?.messages[0]?.content).toBe('本地完整回复')
    expect(merged.s1?.messages[0]?.status).toBe('completed')
  })

  it('clears a live turn when delayed history already contains its completed message', () => {
    const live = updateStreaming({}, 's1', { messageId: 'm1', contentDelta: '已落库回复' })
    const history = {
      s1: {
        ...emptySnapshot('s1'),
        messages: [{ ...message('s1:m1', 'agent', '已落库回复'), status: 'completed', completed_at: '2026-09-09T00:00:01.000Z' }],
      },
    }
    const merged = mergeLoadedSnapshots(live, history)
    expect(merged.s1?.streaming).toBeNull()
    expect(merged.s1?.running).toBe(false)
    expect(merged.s1?.messages[0]?.content).toBe('已落库回复')
  })
})
