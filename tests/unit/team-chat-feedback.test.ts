import { afterEach, describe, expect, it, vi } from 'vitest'
import { aggregateSnapshots, applyEventToSnapshot, emptySnapshot, finalizeSnapshot, mergeLoadedSnapshots, restoreTeamSnapshot } from '../../ui/src/components/team/team-chat-state'
import { beginTeamPrompt, rejectTeamPrompt } from '../../ui/src/components/team/team-chat-pending'
import { mergeTeamMessageRefresh } from '../../ui/src/components/team/team-chat-refresh'
import type { MessageData, SessionEventData } from '../../ui/src/stores/session-events'

const startedAt = '2026-09-11T00:00:00.000Z'
function human(id = 's1:h1'): MessageData {
  return { id, session_id: 's1', role: 'human', content: 'hello', thinking: null, tool_calls_json: null, decision_json: null, timestamp: startedAt }
}
function event(sequence: number, type: string, payload: Record<string, unknown> = {}, sessionId = 's1'): SessionEventData {
  return { id: `e${sequence}`, session_id: sessionId, message_id: typeof payload.messageId === 'string' ? payload.messageId : 'm1', sequence, type, payload_json: JSON.stringify({ messageId: 'm1', ...payload }), created_at: startedAt }
}
function pending(): ReturnType<typeof applyEventToSnapshot> {
  return { s1: beginTeamPrompt(emptySnapshot('s1'), human()) }
}

afterEach(() => vi.useRealTimers())
describe('team prompt feedback', () => {
  it('immediately exposes a pending Master reply with a stable start time', () => {
    const result = aggregateSnapshots(pending(), ['s1'], 's1')
    expect(result.streaming).toHaveLength(1)
    expect(result.streaming[0].stage).toBe('正在准备 Agent...')
    expect(result.streaming[0].startedAt).toBe(startedAt)
    expect(result.running).toBe(true)
  })

  it('replaces the pending reply on the first real event without resetting its clock', () => {
    const live = applyEventToSnapshot(pending(), 's1', event(1, 'thinking.chunk', { thinking: 'thinking' }), 's1')
    const result = aggregateSnapshots(live, ['s1'], 's1')
    expect(result.streaming).toHaveLength(1)
    expect(result.streaming[0]).toMatchObject({ id: 's1:m1', startedAt, thinking: 'thinking' })
  })

  it('keeps waiting feedback through metadata and hidden lifecycle events', () => {
    const metadata = applyEventToSnapshot(pending(), 's1', event(1, 'config.update', { configOptions: [] }), 's1')
    const hidden = applyEventToSnapshot(metadata, 's1', event(2, 'lifecycle.accepted'), 's1')
    expect(aggregateSnapshots(hidden, ['s1'], 's1').streaming).toHaveLength(1)
    expect(hidden.s1.running).toBe(true)
  })

  it('preserves a pending send when older history finishes loading', () => {
    const loaded = restoreTeamSnapshot(emptySnapshot('s1'), [], 0)
    const result = mergeLoadedSnapshots(pending(), { s1: loaded })
    expect(result.s1.streaming?.startedAt).toBe(startedAt)
    expect(result.s1.running).toBe(true)
  })

  it('reconciles a completed history response instead of keeping a pending spinner', () => {
    const loaded = restoreTeamSnapshot({ ...emptySnapshot('s1'), events: [event(1, 'message.user', { messageId: 'h1' }), event(2, 'lifecycle.prompt_received')], messages: [human(), { ...human('s1:m1'), role: 'agent', content: 'done', status: 'completed', completed_at: '2026-09-11T00:00:05.000Z' }] }, [], 3)
    const result = mergeLoadedSnapshots(pending(), { s1: loaded })
    expect(result.s1.streaming).toBeNull()
    expect(result.s1.running).toBe(false)
  })

  it('clears a recovered reply whose clock started 1ms before the human was persisted', () => {
    const messages: MessageData[] = [
      { ...human(), timestamp: '2026-09-11T00:00:00.001Z' },
      { ...human('s1:m1'), role: 'agent', content: 'done', status: 'completed', started_at: startedAt, timestamp: '2026-09-11T00:00:05.000Z' },
    ]
    const events = [event(1, 'message.user', { messageId: 'h1' }), event(2, 'lifecycle.prompt_received')]
    const loaded = restoreTeamSnapshot({ ...emptySnapshot('s1'), messages, events }, [], 3)
    const member = applyEventToSnapshot({}, 's2', event(1, 'thinking.chunk', { thinking: 'working' }, 's2'), 's1').s2
    const result = mergeLoadedSnapshots({ ...pending(), s2: member }, { s1: loaded })
    expect(result.s1.streaming).toBeNull()
    expect(result.s1.running).toBe(false)
    expect(result.s1.messages.find(message => message.role === 'agent')?.content).toBe('done')
    expect(result.s2).toBe(member)
    expect(result.s2.running).toBe(true)
  })

  it('does not use a previous reply that finished after the next human timestamp', () => {
    const messages: MessageData[] = [
      { ...human('s1:old'), role: 'agent', content: 'old answer', status: 'completed', timestamp: '2026-09-11T00:00:05.000Z' },
      human(),
    ]
    const events = [event(1, 'lifecycle.prompt_received', { messageId: 'old' }), event(2, 'message.user', { messageId: 'h1' })]
    const loaded = restoreTeamSnapshot({ ...emptySnapshot('s1'), messages, events }, [], 2)
    expect(mergeLoadedSnapshots(pending(), { s1: loaded }).s1.streaming?.id).toContain('pending-team-')
  })

  it('uses source-prefixed recovery events and a later message-only refresh to clear the right pending turn', () => {
    const events = [event(1, 'message.user', { messageId: 'h1' }), event(2, 'lifecycle.prompt_received')]
      .map(item => ({ ...item, id: `s1:${item.id}`, message_id: `s1:${item.message_id}` }))
    const current = pending()
    current.s1.events = events
    const page = { ...emptySnapshot('s1'), messages: [human(), { ...human('s1:m1'), role: 'agent', content: 'done', status: 'completed', started_at: '2026-09-10T23:59:59.999Z' }] }
    expect(mergeTeamMessageRefresh(current, 's1', page).s1.streaming).toBeNull()
    const newer = beginTeamPrompt(current.s1, human('s1:h2'))
    const done = finalizeSnapshot({ s1: newer }, 's1', 'm1')
    const waiting = beginTeamPrompt(done.s1, human('s1:h3'))
    const result = mergeTeamMessageRefresh({ s1: waiting }, 's1', page)
    expect(result.s1.streaming?.id).toContain('h3')
  })

  it('rolls back a rejected pending send', () => {
    const result = rejectTeamPrompt(pending().s1, human().id)
    expect(result.streaming).toBeNull()
    expect(result.running).toBe(false)
    expect(result.messages).toHaveLength(0)
  })

  it('does not compare server history with the local clock when restoring pending feedback', () => {
    const messages = [
      { ...human('s1:old'), role: 'agent', status: 'completed', timestamp: '2026-09-11T00:02:00.000Z' },
      { ...human(), timestamp: '2026-09-11T00:02:05.000Z' },
    ]
    const loaded = restoreTeamSnapshot({ ...emptySnapshot('s1'), messages }, [], 1)
    const result = mergeLoadedSnapshots(pending(), { s1: loaded })
    expect(result.s1.running).toBe(true)
    expect(result.s1.streaming?.startedAt).toBe(startedAt)
  })

  it('keeps a stable local start when history catches up with a pending reply', () => {
    const loaded = restoreTeamSnapshot({ ...emptySnapshot('s1'), messages: [{ ...human('s1:m1'), role: 'agent', status: 'running', timestamp: '2026-09-11T00:00:03.000Z' }] }, [], 1)
    const result = mergeLoadedSnapshots(pending(), { s1: loaded })
    expect(result.s1.streaming).toMatchObject({ id: 'm1', startedAt })
  })

  it('does not replace a running reply or clear it when a queued send is rejected', () => {
    const live = applyEventToSnapshot(pending(), 's1', event(1, 'message.chunk', { role: 'agent', contentDelta: 'running' }), 's1')
    const queued = beginTeamPrompt(live.s1, human('s1:h2'))
    const result = rejectTeamPrompt(queued, 's1:h2')
    expect(result.streaming).toBe(live.s1.streaming)
    expect(result.running).toBe(true)
    expect(result.messages.map(message => message.id)).toEqual(['s1:h1'])
  })

  it('keeps each member clock and usage independent', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-09-11T00:00:05.000Z'))
    const withMember = applyEventToSnapshot(pending(), 's2', { ...event(1, 'message.chunk', { role: 'agent', contentDelta: 'member' }, 's2'), created_at: new Date().toISOString() }, 's1')
    expect(aggregateSnapshots(withMember, ['s1', 's2'], 's1').streaming).toHaveLength(2)
    const master = applyEventToSnapshot(withMember, 's1', event(1, 'message.chunk', { role: 'agent', contentDelta: 'master' }), 's1')
    const done = applyEventToSnapshot(master, 's1', event(2, 'message.done', { turnUsage: { inputTokens: 11, outputTokens: 3, totalTokens: 14 } }), 's1')
    const completed = done.s1.messages.find(message => message.role === 'agent')!
    expect(completed.started_at).toBe(startedAt)
    expect(completed.completed_at).toBe('2026-09-11T00:00:05.000Z')
    expect(JSON.parse(completed.decision_json!)).toMatchObject({ inputTokens: 11, outputTokens: 3 })
    expect(done.s2.streaming?.startedAt).toBe('2026-09-11T00:00:05.000Z')
    expect(done.s2.running).toBe(true)
  })

  it.each(['failed', 'cancelled'])('clears %s replies even before a content event', (status) => {
    const result = finalizeSnapshot(pending(), 's1', 'm1', 's1', status, status === 'failed' ? 'failed' : undefined)
    expect(result.s1.streaming).toBeNull()
    expect(result.s1.messages.at(-1)).toMatchObject({ id: 's1:m1', status, started_at: startedAt })
  })

  it('accepts a terminal event while the local turn still has a pending id', () => {
    const done = applyEventToSnapshot(pending(), 's1', event(1, 'message.done', { stopReason: 'error', error: 'failed' }), 's1')
    expect(done.s1.running).toBe(false)
    expect(done.s1.messages.at(-1)?.status).toBe('failed')
  })
})
