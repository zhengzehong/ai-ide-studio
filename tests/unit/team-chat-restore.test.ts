import { describe, expect, it } from 'vitest'
import { applyEventToSnapshot, emptySnapshot, finalizeSnapshot, mergeLoadedSnapshots, restoreTeamSnapshot, mergeProcessItem, updateStreaming, type Snapshot } from '../../ui/src/components/team/team-chat-state'
import { createEmptyTurn, turnFromProcessItems } from '../../ui/src/stores/turn-blocks'
import type { SessionEventData, TurnProcessItemInfo } from '../../ui/src/stores/session-events'

function event(sequence: number, type: string, payload: Record<string, unknown>, sessionId = 's1'): SessionEventData {
  return { id: `e${sequence}`, session_id: sessionId, message_id: String(payload.messageId || 'm1'), sequence, type, payload_json: JSON.stringify({ messageId: 'm1', ...payload }), created_at: '2026-09-10T00:00:00Z' }
}
function snapshot(status = 'running'): Snapshot {
  return { ...emptySnapshot('s1'), running: status === 'running', messages: [{ id: 's1:m1', session_id: 'master', role: 'agent', content: '', thinking: null, tool_calls_json: null, decision_json: null, timestamp: '2026-09-10T00:00:00Z', status }] }
}
const chunk = (sequence: number, text: string): SessionEventData => event(sequence, 'message.chunk', { role: 'agent', contentDelta: text })

describe('team restoration boundaries', () => {
  it('keeps Master capability changes after the previous turn completed', () => {
    const update = event(11, 'config.update', { configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'new', options: [{ value: 'new', name: 'New' }] }] })
    const result = applyEventToSnapshot({ s1: snapshot('completed') }, 's1', update, 'master')
    expect(result.s1.capabilities.currentModelId).toBe('new')
    expect(result.s1.streaming).toBeNull()
  })
  it('does not replace live text with an empty shell even without replay metadata', () => {
    const live = updateStreaming({}, 's1', { messageId: 'm1', contentDelta: 'keep' })
    const empty = { ...snapshot(), streaming: createEmptyTurn('m1') }
    expect(mergeLoadedSnapshots(live, { s1: empty }).s1.streaming?.content).toBe('keep')
  })

  it('rejects a completed empty streaming shell even on initial merge', () => {
    const loaded = { ...snapshot('completed'), streaming: createEmptyTurn('m1'), running: true }
    const merged = mergeLoadedSnapshots({}, { s1: loaded })
    expect(merged.s1.streaming).toBeNull()
    expect(merged.s1.running).toBe(false)
  })
  it('does not revive completed history from recovery lifecycle events on cold return', () => {
    const state = restoreTeamSnapshot(snapshot('completed'), [], 10)
    expect(state.streaming).toBeNull()
    expect(mergeLoadedSnapshots({}, { s1: state }).s1.running).toBe(false)
  })

  it('rebuilds thinking, notes and tools beyond a 1000 event window', () => {
    const events = Array.from({ length: 1100 }, (_, i) => event(i + 1, 'thinking.chunk', { thinking: 'a' }))
    events.push(chunk(1101, 'note'), event(1102, 'tool.call', { toolCall: { id: 't1', title: 'Read', status: 'in_progress' } }))
    const state = restoreTeamSnapshot(snapshot(), events, 0)
    expect(state.streaming?.thinking).toHaveLength(1100)
    expect(state.streaming?.processBlocks.some(block => block.kind === 'note' && block.text === 'note')).toBe(true)
    expect(state.streaming?.toolCalls[0]?.id).toBe('t1')
  })

  it('joins the recovered prefix and live tail exactly once', () => {
    let current = applyEventToSnapshot({}, 's1', chunk(2, 'B'), 'master')
    current = applyEventToSnapshot(current, 's1', chunk(3, 'C'), 'master')
    const loaded = restoreTeamSnapshot(snapshot(), [chunk(1, 'A'), chunk(2, 'B')], 0)
    const merged = mergeLoadedSnapshots(current, { s1: loaded })
    expect(merged.s1.streaming?.content).toBe('ABC')
    expect(applyEventToSnapshot(merged, 's1', chunk(2, 'B'), 'master').s1.streaming?.content).toBe('ABC')
  })

  it('keeps the completed reply when done arrives during history loading', () => {
    let current = applyEventToSnapshot({}, 's1', chunk(2, 'B'), 'master')
    current = applyEventToSnapshot(current, 's1', event(3, 'message.done', {}), 'master')
    const loaded = restoreTeamSnapshot(snapshot(), [chunk(1, 'A')], 0)
    const merged = mergeLoadedSnapshots(current, { s1: loaded })
    expect(merged.s1.streaming).toBeNull()
    expect(merged.s1.running).toBe(false)
    expect(merged.s1.messages.find(message => message.id === 's1:m1')?.content).toBe('AB')
  })

  it('does not mask completion already included in messageEvents with a stale running page', () => {
    const state = restoreTeamSnapshot(snapshot(), [chunk(1, 'A'), event(2, 'message.done', {})], 0)
    expect(state.streaming).toBeNull()
    expect(state.messages[0].status).toBe('completed')
    expect(state.messages[0].content).toBe('A')
  })

  it('does not let an old completed turn clear a newer turn', () => {
    let current = applyEventToSnapshot({}, 's1', chunk(1, 'old'), 'master')
    current = applyEventToSnapshot(current, 's1', event(2, 'message.done', {}), 'master')
    current = applyEventToSnapshot(current, 's1', event(3, 'message.chunk', { role: 'agent', messageId: 'm2', contentDelta: 'new' }), 'master')
    const loaded = restoreTeamSnapshot(snapshot('completed'), [], 2)
    const merged = mergeLoadedSnapshots(current, { s1: loaded })
    expect(merged.s1.streaming?.id).toBe('m2')
    expect(merged.s1.streaming?.content).toBe('new')
    expect(merged.s1.running).toBe(true)
  })

  it('keeps independent member streams when merging a single session', () => {
    const current = applyEventToSnapshot({}, 's2', event(1, 'message.chunk', { role: 'agent', messageId: 'm2', contentDelta: 'member' }, 's2'), 'master')
    const merged = mergeLoadedSnapshots(current, { s1: restoreTeamSnapshot(snapshot(), [chunk(1, 'A')], 0) })
    expect(merged.s2.streaming?.content).toBe('member')
    expect(merged.s1.streaming?.content).toBe('A')
  })

  it.each(['failed', 'cancelled'])('does not resurrect a %s reply', status => {
    const state = restoreTeamSnapshot(snapshot(status), [], 2)
    expect(applyEventToSnapshot({ s1: state }, 's1', event(3, 'lifecycle.prompt_sent', { content: 'starting' }), 'master').s1.streaming).toBeNull()
  })

  it('ignores a late duplicate session.done after a new reply has started', () => {
    let current = applyEventToSnapshot({}, 's1', chunk(1, 'old'), 'master')
    current = applyEventToSnapshot(current, 's1', event(2, 'message.done', {}), 'master')
    current = applyEventToSnapshot(current, 's1', event(3, 'message.chunk', { messageId: 'm2', role: 'agent', contentDelta: 'new' }), 'master')
    expect(finalizeSnapshot(current, 's1', 'm1', 'master').s1.streaming?.id).toBe('m2')
  })

  it('does not consume thinking snapshots a second time or revive a finished turn', () => {
    const item: TurnProcessItemInfo = { id: 'p1', session_id: 's1', message_id: 'm1', sequence: 1, kind: 'thinking', status: 'running', title: null, summary: null, preview: null, content: 'think', meta_json: null, created_at: '', updated_at: '' }
    const block = turnFromProcessItems('m1', [item]).processBlocks[0]
    const live = restoreTeamSnapshot(snapshot(), [event(1, 'thinking.chunk', { thinking: 'think' })], 0)
    expect(mergeProcessItem({ s1: live }, 's1', item, block).s1.streaming?.thinking).toBe('think')
    const completed = restoreTeamSnapshot(snapshot('completed'), [], 2)
    expect(mergeProcessItem({ s1: completed }, 's1', item, block).s1.streaming).toBeNull()
  })

  it('preserves live assignment metadata', () => {
    const assignment = event(1, 'message.user', { messageId: 'h1', content: 'review', senderRole: 'team-assignment', senderName: 'Master' })
    const first = applyEventToSnapshot({}, 's1', assignment, 'master')
    const second = applyEventToSnapshot(first, 's1', chunk(2, 'answer'), 'master')
    expect(second.s1.streaming?.teamAssignment?.content).toBe('review')
  })
})
