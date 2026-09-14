import { describe, expect, it, vi } from 'vitest'
import { aggregateSnapshots, applyEventToSnapshot, compareTeamMessages, emptySnapshot, finalizeSnapshot, mergeLoadedSnapshots, updateStreaming, type Snapshot } from '../../ui/src/components/team/TeamChatPane'
import { defaultCaps } from '../../ui/src/stores/session-events'
import { attachTeamAssignments, assignmentFromEvent, mapTeamMessage } from '../../ui/src/components/team/team-chat-assignments'

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
  it('preserves a non-empty history message when completion arrives with no live stream', () => {
    const state: Record<string, Snapshot> = {
      s1: {
        ...emptySnapshot('s1'),
        messages: [{ ...message('s1:m1', 'agent', '历史最终回复'), status: 'running' }],
      },
    }
    const completed = finalizeSnapshot(state, 's1', 'm1', 'master-1')
    expect(completed.s1?.messages[0]?.content).toBe('历史最终回复')
    expect(completed.s1?.messages[0]?.status).toBe('completed')
    expect(completed.s1?.running).toBe(false)
  })

  it('recovers final content from persisted events when the live stream was missed', () => {
    const state: Record<string, Snapshot> = {
      s1: {
        ...emptySnapshot('s1'),
        events: [event('e1', 'message.chunk', { messageId: 'm1', role: 'agent', contentDelta: '事件中的回复' })],
      },
    }
    const completed = finalizeSnapshot(state, 's1', 'm1', 'master-1')
    expect(completed.s1?.messages[0]?.content).toBe('事件中的回复')
    expect(completed.s1?.messages[0]?.session_id).toBe('master-1')
  })

  it('keeps partial output and exposes the provider error when a member turn fails', () => {
    const live = updateStreaming({}, 's1', { messageId: 'm1', contentDelta: '已完成部分工作' })
    const completed = finalizeSnapshot(live, 's1', 'm1', 'master-1', 'failed', '余额不足')
    expect(completed.s1?.messages[0]?.content).toContain('已完成部分工作')
    expect(completed.s1?.messages[0]?.content).toContain('执行失败：余额不足')
    expect(completed.s1?.messages[0]?.status).toBe('failed')
  })

  it('moves a Master assignment into the following member reply instead of showing it as a user bubble', () => {
    const assignment = mapTeamMessage({ ...message('m0', 'human', '修复登录问题'), sender_name: 'Master', sender_role: 'team-assignment' }, 'member-1', 'master-1', '李白', 'member')
    const reply = mapTeamMessage({ ...message('m1', 'agent', '已经修复'), sender_name: null, sender_role: 'assistant' }, 'member-1', 'master-1', '李白', 'member')
    const result = attachTeamAssignments([assignment, reply])
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.role).toBe('agent')
    expect(result.messages[0]?.teamAssignment).toEqual({ content: '修复登录问题', fromName: 'Master' })
  })

  it('recognizes live assignment events with sender metadata', () => {
    const live = assignmentFromEvent(event('e1', 'message.user', { messageId: 'm0', content: '检查日志', senderRole: 'team-assignment', senderName: 'Master' }))
    expect(live).toEqual({ content: '检查日志', fromName: 'Master' })
  })

  it('finalizes a live turn with its start time so concurrent replies stay in chronological order', () => {
    vi.useFakeTimers()
    try {
      // 成员回合 10:00 开始、10:05 完成;Master 的总结 10:02 已落库。
      // 若 finalize 用完成时间,成员回复会短暂错序到总结之后,与 reload 后的落库顺序不一致。
      vi.setSystemTime(new Date('2026-09-09T10:00:00.000Z'))
      const live = updateStreaming({}, 'member-1', { messageId: 'm1', contentDelta: '成员结论' })
      vi.setSystemTime(new Date('2026-09-09T10:05:00.000Z'))
      const completed = finalizeSnapshot(live, 'member-1', 'm1', 'master-1')
      expect(completed['member-1']?.messages[0]?.timestamp).toBe('2026-09-09T10:00:00.000Z')

      const masterSnapshot = {
        ...emptySnapshot('master-1'),
        messages: [{ ...message('master-1:m2', 'agent', 'Master 总结'), session_id: 'master-1', timestamp: '2026-09-09T10:02:00.000Z' }],
      }
      const aggregate = aggregateSnapshots({ ...completed, 'master-1': masterSnapshot }, ['master-1', 'member-1'], 'master-1')
      expect(aggregate.messages.map((item) => item.id)).toEqual(['member-1:m1', 'master-1:m2'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps team order when history replaces a live completion timestamp', () => {
    const member = { ...message('member-1:m1', 'agent', '成员结论'), session_id: 'member-1', started_at: '2026-09-09T10:00:00.000Z', timestamp: '2026-09-09T10:05:00.000Z' }
    const master = { ...message('master-1:m2', 'agent', 'Master 总结'), session_id: 'master-1', started_at: '2026-09-09T10:02:00.000Z', timestamp: '2026-09-09T10:02:00.000Z' }
    const live = [member, master].sort(compareTeamMessages)
    const history = [member, { ...master, timestamp: '2026-09-09T10:06:00.000Z' }].sort(compareTeamMessages)
    expect(live.map(item => item.id)).toEqual(history.map(item => item.id))
    const merged = mergeLoadedSnapshots(
      { 'member-1': { ...emptySnapshot('member-1'), messages: [member] }, 'master-1': { ...emptySnapshot('master-1'), messages: [master] } },
      { 'member-1': { ...emptySnapshot('member-1'), messages: [{ ...member, timestamp: '2026-09-09T10:05:00.000Z' }] }, 'master-1': { ...emptySnapshot('master-1'), messages: [{ ...master, timestamp: '2026-09-09T10:06:00.000Z' }] } },
    )
    expect(aggregateSnapshots(merged, ['master-1', 'member-1'], 'master-1').messages.map(item => item.id)).toEqual(['member-1:m1', 'master-1:m2'])
  })

  it('keeps the recorded turn start across chunk and live-event updates', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-09T10:00:00.000Z'))
      const live = updateStreaming({}, 's1', { messageId: 'm1', contentDelta: 'A' })
      vi.setSystemTime(new Date('2026-09-09T10:01:00.000Z'))
      const chunked = updateStreaming(live, 's1', { messageId: 'm1', contentDelta: 'B' })
      const evented = applyEventToSnapshot(chunked, 's1', event('e1', 'usage.update', { usage: { contextSize: 10, contextUsed: 1 } }), 'team')
      expect(chunked.s1?.streaming?.startedAt).toBe('2026-09-09T10:00:00.000Z')
      expect(evented.s1?.streaming?.startedAt).toBe('2026-09-09T10:00:00.000Z')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps team-system wake metadata for system-notice rendering instead of folding it into an assignment', () => {
    const wake = mapTeamMessage({ ...message('m9', 'human', '系统通知：Team 成员有新的异步进展。'), sender_name: '系统', sender_role: 'team-system' }, 'master-1', 'master-1', 'Master', 'leader')
    expect(wake.sender_role).toBe('team-system')
    expect(wake.sender_name).toBe('系统')
    const result = attachTeamAssignments([wake])
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.teamAssignment).toBeUndefined()
  })

  it('sorts the user question before an agent turn that started in the same instant', () => {
    // 实测倒挂对:human 落库晚于回合开始 1ms(agent started_at=.000 / human timestamp=.001)
    const human = { ...message('master-1:h1', 'human', '帮我写个文档'), session_id: 'master-1', timestamp: '2026-09-14T07:21:55.396Z' }
    const liveAgent = { ...message('master-1:a1', 'agent', '好的,文档如下'), session_id: 'master-1', started_at: '2026-09-14T07:21:55.395Z', timestamp: '2026-09-14T07:21:55.395Z' }
    const historyAgent = { ...liveAgent, timestamp: '2026-09-14T07:22:30.289Z' }
    expect([liveAgent, human].sort(compareTeamMessages).map((item) => item.role)).toEqual(['human', 'agent'])
    expect([historyAgent, human].sort(compareTeamMessages).map((item) => item.role)).toEqual(['human', 'agent'])
  })

  it('still orders unrelated turns by real time beyond the tolerance window', () => {
    const human = { ...message('master-1:h1', 'human', '新问题'), session_id: 'master-1', timestamp: '2026-09-14T07:30:00.000Z' }
    const earlierAgent = { ...message('member-1:a1', 'agent', '自治回合'), session_id: 'member-1', started_at: '2026-09-14T07:29:57.000Z', timestamp: '2026-09-14T07:29:58.000Z' }
    const laterAgent = { ...message('member-2:a2', 'agent', '慢派发回合'), session_id: 'member-2', started_at: '2026-09-14T07:30:03.000Z', timestamp: '2026-09-14T07:30:04.000Z' }
    expect([laterAgent, earlierAgent, human].sort(compareTeamMessages).map((item) => item.id)).toEqual(['member-1:a1', 'master-1:h1', 'member-2:a2'])
  })

  it('preserves time order between messages of the same role inside the tolerance window', () => {
    const first = { ...message('m1', 'human', '第一条'), timestamp: '2026-09-14T07:30:00.000Z' }
    const second = { ...message('m2', 'human', '第二条'), timestamp: '2026-09-14T07:30:00.400Z' }
    expect([second, first].sort(compareTeamMessages).map((item) => item.id)).toEqual(['m1', 'm2'])
  })
})
