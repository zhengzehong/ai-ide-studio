import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { queryClient } from '../../ui/src/services/query-client'
import { wsClient } from '../../ui/src/services/ws-client'
import {
  loadTeamSessionBase,
  loadTeamSessionProgressive,
  loadTeamTurnReplay,
  resolveTurnReplayPageBudget,
  MOBILE_TURN_REPLAY_PAGE_BUDGET,
  PC_TURN_REPLAY_PAGE_BUDGET,
} from '../../ui/src/components/team/team-chat-loader'
import { applyEventToSnapshot, compareTeamMessages, emptySnapshot, mergeLoadedSnapshots, mergeTeamTurnReplay } from '../../ui/src/components/team/team-chat-state'
import { mergeTeamMessageRefresh } from '../../ui/src/components/team/team-chat-refresh'
import type { MessageData, SessionEventData } from '../../ui/src/stores/session-events'

const startedAt = '2026-09-11T00:00:00.000Z'
const AUTO_ID = 'auto-1234'

function agentRow(overrides: Partial<MessageData> = {}): MessageData {
  return { id: AUTO_ID, session_id: 's1', role: 'agent', content: '', status: 'running', timestamp: startedAt, started_at: startedAt, thinking: null, tool_calls_json: null, decision_json: null, ...overrides }
}

function chunkEvent(sequence: number, text: string, payload: Record<string, unknown> = {}): SessionEventData {
  return { id: `e${sequence}`, session_id: 's1', message_id: AUTO_ID, sequence, type: 'message.chunk', payload_json: JSON.stringify({ messageId: AUTO_ID, role: 'agent', contentDelta: text, ...payload }), created_at: new Date(Date.parse(startedAt) + sequence).toISOString() }
}

function doneEvent(sequence: number, messageId = AUTO_ID): SessionEventData {
  return { id: `e${sequence}`, session_id: 's1', message_id: messageId, sequence, type: 'message.done', payload_json: JSON.stringify({ messageId, stopReason: 'end_turn' }), created_at: new Date(Date.parse(startedAt) + sequence).toISOString() }
}

/** P1:基础快照的恢复边界改由轻端点 sessions.teamMemberState 提供(不再拉 500 条历史事件)。 */
function memberState(latestSequence: number): Record<string, unknown> {
  return { sessionId: 's1', latestSequence, usage: null, pendingPermissions: [], pendingElicitations: [] }
}

function mockBase(row: MessageData | null, latestSequence: number): void {
  vi.spyOn(wsClient, 'request').mockImplementation(async (message: Record<string, unknown>) => {
    if (message.type === 'sessions.teamMemberState') return memberState(latestSequence)
    return {}
  })
  vi.spyOn(queryClient, 'listSessionMessages').mockResolvedValue({ items: row ? [row] : [], hasMore: false, nextCursor: null })
}

/** 只统计重放类请求,忽略基础快照的轻端点调用。 */
function replayCalls(rpc: { mock: { calls: unknown[][] } }): unknown[][] {
  return rpc.mock.calls.filter(([message]) => (message as { type?: string }).type !== 'sessions.teamMemberState')
}

function mockReplay(events: SessionEventData[], items: unknown[] = []): MockInstance {
  return vi.spyOn(wsClient, 'request').mockImplementation(async (message: Record<string, unknown>) => {
    if (message.type === 'sessions.messageEventsPage') return { items: events, nextSequence: events.at(-1)?.sequence ?? 0, hasMore: false }
    if (message.type === 'sessions.messageProcess') return items
    if (message.type === 'sessions.teamMemberState') return memberState(5)
    return {}
  })
}

afterEach(() => vi.restoreAllMocks())

describe('team session progressive load (P0-1)', () => {
  it('delivers the message page without waiting for the running turn replay', async () => {
    mockBase(agentRow({ content: '部分正文' }), 5)
    const rpc = vi.spyOn(wsClient, 'request')
    const base = await loadTeamSessionBase('view', 's1', 's1', 'Master', 'Master')

    // 基础快照只发一次轻端点请求,不产生任何回合重放请求
    expect(replayCalls(rpc)).toEqual([])
    expect(rpc).toHaveBeenCalledWith({ type: 'sessions.teamMemberState', sessionId: 's1' })
    expect(base.replay).toEqual({ messageId: AUTO_ID, throughSequence: 5 })
    expect(base.snapshot.messages).toHaveLength(1)
    expect(base.snapshot.streaming?.id).toBe(AUTO_ID)
    expect(base.snapshot.running).toBe(true)
    // 恢复边界已钉住:重放范围内的事件不会被实时流重复应用
    expect(base.snapshot.replaySequence).toBe(5)
  })

  it('plans no replay when no member turn is running (idle conversation keeps the old request count)', async () => {
    mockBase(agentRow({ status: 'completed', content: 'done', completed_at: startedAt }), 3)
    const rpc = vi.spyOn(wsClient, 'request')
    const base = await loadTeamSessionBase('view', 's1', 's1', 'Master', 'Master')

    expect(base.replay).toBeNull()
    expect(base.snapshot.running).toBe(false)
    expect(replayCalls(rpc)).toEqual([])
  })

  it('resolves after the base snapshot while the replay backfill keeps running in the background', async () => {
    mockBase(agentRow(), 5)
    let releaseEvents: ((value: unknown) => void) | null = null
    vi.spyOn(wsClient, 'request').mockImplementation((message: Record<string, unknown>) => {
      if (message.type === 'sessions.messageEventsPage') return new Promise(resolve => { releaseEvents = resolve })
      return Promise.resolve([])
    })
    const order: string[] = []
    const done = loadTeamSessionProgressive('view', 's1', 's1', 'Master', 'Master', {
      isActive: () => true,
      onBase: () => order.push('base'),
      onReplay: () => order.push('replay'),
      onReplayError: () => order.push('error'),
    })
    await done

    expect(order).toEqual(['base'])
    expect(releaseEvents).not.toBeNull()
    releaseEvents!({ items: [chunkEvent(1, '唤醒注记')], nextSequence: 1, hasMore: false })
    await vi.waitFor(() => expect(order).toEqual(['base', 'replay']))
  })

  it('drops a backfill result that became stale while the replay was in flight', async () => {
    mockBase(agentRow(), 5)
    mockReplay([chunkEvent(1, '旧结果')])
    let active = true
    const order: string[] = []
    await loadTeamSessionProgressive('view', 's1', 's1', 'Master', 'Master', {
      isActive: () => active,
      onBase: () => { order.push('base'); active = false },
      onReplay: () => order.push('replay'),
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(order).toEqual(['base'])
  })

  it('reports a failed backfill without failing the delivered base snapshot', async () => {
    mockBase(agentRow(), 5)
    vi.spyOn(wsClient, 'request').mockImplementation(async (message: Record<string, unknown>) => {
      if (message.type === 'sessions.teamMemberState') return memberState(5)
      throw new Error('查询超时')
    })
    const order: string[] = []
    const failing = loadTeamSessionProgressive('view', 's1', 's1', 'Master', 'Master', {
      isActive: () => true,
      onBase: () => order.push('base'),
      onReplay: () => order.push('replay'),
      onReplayError: (error) => order.push(`error:${error instanceof Error ? error.message : ''}`),
    })
    await expect(failing).resolves.toBeUndefined()
    await vi.waitFor(() => expect(order).toEqual(['base', 'error:查询超时']))
  })

  it('sends the turn replay page budget with the request (PC default, mobile profile resolution)', async () => {
    mockBase(agentRow(), 5)
    const rpc = mockReplay([chunkEvent(1, 'x')])
    const base = await loadTeamSessionBase('view', 's1', 's1', 'Master', 'Master')
    await loadTeamTurnReplay('s1', base.snapshot, base.replay!)

    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ type: 'sessions.messageEventsPage', maxItems: 100, maxBytes: 128 * 1024 }))
    expect(rpc).toHaveBeenCalledWith({ type: 'sessions.teamMemberState', sessionId: 's1' })
    expect(resolveTurnReplayPageBudget('mobile')).toEqual(MOBILE_TURN_REPLAY_PAGE_BUDGET)
    expect(resolveTurnReplayPageBudget(undefined)).toEqual(PC_TURN_REPLAY_PAGE_BUDGET)
    expect(resolveTurnReplayPageBudget('desktop')).toEqual(PC_TURN_REPLAY_PAGE_BUDGET)
    expect(MOBILE_TURN_REPLAY_PAGE_BUDGET.maxItems).toBe(500)
    expect(MOBILE_TURN_REPLAY_PAGE_BUDGET.maxBytes).toBe(512 * 1024)
  })
})

describe('team turn replay merge order (P0-1 hardening)', () => {
  it('rebuilds the running turn from the backfill and keeps live events that arrived meanwhile exactly once', async () => {
    mockBase(agentRow({ content: '部分正文' }), 5)
    mockReplay([chunkEvent(1, '唤醒注记'), chunkEvent(2, '前半段')])
    const base = await loadTeamSessionBase('view', 's1', 's1', 'Master', 'Master')

    // 基础快照先落地;后台补齐期间实时事件 6、7 到达
    let current = mergeLoadedSnapshots({}, { s1: base.snapshot })
    current = applyEventToSnapshot(current, 's1', chunkEvent(6, '实时补足'), 's1')
    current = applyEventToSnapshot(current, 's1', doneEvent(7), 's1')
    expect(current.s1.messages).toHaveLength(1)

    const replayed = await loadTeamTurnReplay('s1', base.snapshot, base.replay!)
    const merged = mergeTeamTurnReplay(current, 's1', replayed)

    const rows = merged.s1.messages.filter(message => message.id === 's1:auto-1234')
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('completed')
    expect(rows[0].content).toContain('唤醒注记')
    expect(rows[0].content).toContain('前半段')
    expect(rows[0].content).toContain('实时补足')
    expect(merged.s1.events.map(event => event.id).filter(id => id === 's1:e6')).toHaveLength(1)
    expect(merged.s1.events.map(event => event.id).filter(id => id === 's1:e7')).toHaveLength(1)
    expect(merged.s1.streaming).toBeNull()
    expect(merged.s1.running).toBe(false)
  })

  it('does not roll a completed row back to the stale running snapshot carried by the backfill', () => {
    const completedRow: MessageData = { ...agentRow({ status: 'completed', content: '完整正文', completed_at: startedAt }), id: `s1:${AUTO_ID}` }
    const current = { s1: { ...emptySnapshot('s1'), messages: [completedRow] } }
    const replay = { ...emptySnapshot('s1'), replaySequence: 5, replayEvents: [], messages: [{ ...agentRow({ content: '部分正文' }), id: `s1:${AUTO_ID}` }] }

    const merged = mergeTeamTurnReplay(current, 's1', replay)

    expect(merged.s1.messages).toHaveLength(1)
    expect(merged.s1.messages[0]).toMatchObject({ status: 'completed', content: '完整正文' })
    expect(merged.s1.streaming).toBeNull()
    expect(merged.s1.running).toBe(false)
  })

  it('inserts a completed row carried by the backfill when the current state has none', () => {
    const current = { s1: { ...emptySnapshot('s1'), replaySequence: 5, replayEvents: [] } }
    const completedRow: MessageData = { ...agentRow({ status: 'completed', content: '后台补齐的回合正文', completed_at: startedAt }), id: `s1:${AUTO_ID}` }
    const replay = { ...emptySnapshot('s1'), replaySequence: 5, replayEvents: [], messages: [completedRow] }

    const merged = mergeTeamTurnReplay(current, 's1', replay)

    expect(merged.s1.messages).toHaveLength(1)
    expect(merged.s1.messages[0]).toMatchObject({ id: `s1:${AUTO_ID}`, status: 'completed', content: '后台补齐的回合正文' })
  })

  it('keeps an autonomous turn row inserted during the backfill window and preserves team ordering', () => {
    const runningRow: MessageData = { ...agentRow({ content: '' }), id: `s1:${AUTO_ID}` }
    const currentBase = { s1: { ...emptySnapshot('s1'), messages: [runningRow], replaySequence: 5, replayEvents: [] } }
    // 后台补齐在途:自治回合(后台唤醒)在该窗口内完成并落行(实时 done + 落库刷新)
    const autonomousRow: MessageData = { ...agentRow({ id: 'auto-wake-9', status: 'completed', content: '[后台唤醒] 由后台任务完成或系统通知触发的自主执行,以下为本回合内容。\n后台结论', timestamp: new Date(Date.parse(startedAt) + 1000).toISOString(), started_at: new Date(Date.parse(startedAt) + 1000).toISOString(), completed_at: new Date(Date.parse(startedAt) + 2000).toISOString() }), id: 's1:auto-wake-9' }
    const refreshed = mergeTeamMessageRefresh(currentBase, 's1', { ...emptySnapshot('s1'), messages: [runningRow, autonomousRow] })

    const replay = { ...emptySnapshot('s1'), replaySequence: 5, replayEvents: [], streaming: null, messages: [{ ...agentRow({ content: '部分' }), id: `s1:${AUTO_ID}` }], senderName: 'Master' }
    const merged = mergeTeamTurnReplay(refreshed, 's1', replay)

    const autonomousRows = merged.s1.messages.filter(message => message.id === 's1:auto-wake-9')
    expect(autonomousRows).toHaveLength(1)
    expect(autonomousRows[0].content).toContain('后台结论')
    expect(merged.s1.messages).toHaveLength(2)
    expect(merged.s1.messages.map(message => message.id)).toEqual([...merged.s1.messages].sort(compareTeamMessages).map(message => message.id))
  })
})
