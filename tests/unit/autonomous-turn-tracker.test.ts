import { afterEach, describe, expect, test, vi } from 'vitest'
import { AutonomousTurnTracker } from '../../src/runtime/service/autonomous-turn-tracker.js'

const TIMINGS = {
  silenceMs: 100,
  originSettleDebounceMs: 20,
  cancelSilenceMs: 30,
  cancelDeadlineMs: 80,
  maxTurnMs: 1_000,
  postTurnGhostMs: 50,
}

function createHarness() {
  let created = 0
  const openTurn = vi.fn(() => {
    created += 1
    return `auto-${created}`
  })
  const settleTurn = vi.fn()
  const dropped: Array<{ updateType: string; kind: string }> = []
  const tracker = new AutonomousTurnTracker({
    openTurn,
    settleTurn,
    onFrameDropped: (_sessionId, updateType, kind) => { dropped.push({ updateType, kind }) },
    timings: TIMINGS,
  })
  return { tracker, openTurn, settleTurn, dropped }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('autonomous turn tracker: 起始分类', () => {
  test('连续强帧只开一个合成回合(幂等)', () => {
    vi.useFakeTimers()
    const h = createHarness()

    expect(h.tracker.handleUnboundFrame('s1', { sessionUpdate: 'agent_thought_chunk' })).toBe('auto-1')
    expect(h.tracker.handleUnboundFrame('s1', { sessionUpdate: 'agent_message_chunk' })).toBe('auto-1')
    expect(h.tracker.handleUnboundFrame('s1', { sessionUpdate: 'tool_call', toolCallId: 't1' })).toBe('auto-1')

    expect(h.openTurn).toHaveBeenCalledTimes(1)
    expect(h.tracker.isOpen('s1')).toBe(true)
  })

  test('弱帧(无 meta usage / 孤儿 tool_call_update)永远不开回合,直接丢弃', () => {
    vi.useFakeTimers()
    const h = createHarness()

    expect(h.tracker.handleUnboundFrame('s1', { sessionUpdate: 'usage_update' })).toBeNull()
    expect(h.tracker.handleUnboundFrame('s1', { sessionUpdate: 'tool_call_update', toolCallId: 'orphan', status: 'completed' })).toBeNull()

    expect(h.openTurn).not.toHaveBeenCalled()
    expect(h.dropped.map((entry) => entry.kind)).toEqual(['unbound-weak-frame', 'unbound-weak-frame'])
    vi.advanceTimersByTime(10_000)
    expect(h.settleTurn).not.toHaveBeenCalled()
  })

  test('正常回合结束后的 trailing 弱帧按 post-turn-ghost 分类(不闪回合)', () => {
    const h = createHarness()

    h.tracker.onRealTurnEnd('s1')
    expect(h.tracker.handleUnboundFrame('s1', { sessionUpdate: 'usage_update' })).toBeNull()

    expect(h.openTurn).not.toHaveBeenCalled()
    expect(h.dropped).toEqual([{ updateType: 'usage_update', kind: 'post-turn-ghost' }])
  })
})

describe('autonomous turn tracker: 结束检测', () => {
  test('静默超时结算安静回合', () => {
    vi.useFakeTimers()
    const h = createHarness()

    h.tracker.handleUnboundFrame('s1', { sessionUpdate: 'agent_message_chunk' })
    vi.advanceTimersByTime(110)

    expect(h.settleTurn).toHaveBeenCalledTimes(1)
    expect(h.settleTurn).toHaveBeenCalledWith('s1', { messageId: 'auto-1', stopReason: 'end_turn', reason: 'silence' })
    expect(h.tracker.isOpen('s1')).toBe(false)
  })

  test('存在未完成 tool 时静默不结算,工具完成 + 静默后才结算', () => {
    vi.useFakeTimers()
    const h = createHarness()

    h.tracker.handleUnboundFrame('s1', { sessionUpdate: 'tool_call', toolCallId: 't1', status: 'in_progress' })
    vi.advanceTimersByTime(350)
    expect(h.settleTurn).not.toHaveBeenCalled()

    h.tracker.observeFrame('s1', { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' })
    vi.advanceTimersByTime(110)
    expect(h.settleTurn).toHaveBeenCalledTimes(1)
    expect(h.settleTurn.mock.calls[0]?.[1]).toMatchObject({ reason: 'silence', stopReason: 'end_turn' })
  })

  test('只有带 _claude/origin 的终结帧触发结算,流中无 meta usage 帧不算', () => {
    vi.useFakeTimers()
    const h = createHarness()

    h.tracker.handleUnboundFrame('s1', { sessionUpdate: 'agent_thought_chunk' })
    h.tracker.observeFrame('s1', { sessionUpdate: 'usage_update' })
    h.tracker.observeFrame('s1', { sessionUpdate: 'usage_update', _meta: { terminal_output_delta: { data: 'x' } } })
    vi.advanceTimersByTime(25)
    expect(h.settleTurn).not.toHaveBeenCalled()

    h.tracker.observeFrame('s1', { sessionUpdate: 'usage_update', _meta: { '_claude/origin': { kind: 'task-notification' } } })
    vi.advanceTimersByTime(25)
    expect(h.settleTurn).toHaveBeenCalledTimes(1)
    expect(h.settleTurn.mock.calls[0]?.[1]).toMatchObject({ reason: 'origin-signal', stopReason: 'end_turn' })
  })

  test('终结帧后的连续 cycle 帧会推迟结算(合并窗口)', () => {
    vi.useFakeTimers()
    const h = createHarness()

    h.tracker.handleUnboundFrame('s1', { sessionUpdate: 'agent_thought_chunk' })
    h.tracker.observeFrame('s1', { sessionUpdate: 'usage_update', _meta: { '_claude/origin': {} } })
    vi.advanceTimersByTime(10)
    h.tracker.observeFrame('s1', { sessionUpdate: 'agent_thought_chunk' })
    vi.advanceTimersByTime(15)
    expect(h.settleTurn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(10)
    expect(h.settleTurn).toHaveBeenCalledTimes(1)
  })

  test('单回合硬上限强制结算挂死 tool 的回合', () => {
    vi.useFakeTimers()
    const h = createHarness()

    h.tracker.handleUnboundFrame('s1', { sessionUpdate: 'tool_call', toolCallId: 't1', status: 'in_progress' })
    vi.advanceTimersByTime(1_000)

    expect(h.settleTurn).toHaveBeenCalledTimes(1)
    expect(h.settleTurn.mock.calls[0]?.[1]).toMatchObject({ reason: 'max-duration', stopReason: 'end_turn' })
  })
})

describe('autonomous turn tracker: 互斥 / 取消 / 清理', () => {
  test('真回合开始立即结算合成回合,且只结算一次(互斥)', () => {
    vi.useFakeTimers()
    const h = createHarness()

    h.tracker.handleUnboundFrame('s1', { sessionUpdate: 'agent_thought_chunk' })
    h.tracker.onRealTurnBegin('s1')
    expect(h.settleTurn).toHaveBeenCalledTimes(1)
    expect(h.settleTurn.mock.calls[0]?.[1]).toMatchObject({ reason: 'real-turn', stopReason: 'end_turn' })

    h.tracker.observeFrame('s1', { sessionUpdate: 'agent_message_chunk' })
    vi.advanceTimersByTime(500)
    expect(h.settleTurn).toHaveBeenCalledTimes(1)
  })

  test('取消请求走短静默:无 tool 时按 cancelled 快速收敛', () => {
    vi.useFakeTimers()
    const h = createHarness()

    h.tracker.handleUnboundFrame('s1', { sessionUpdate: 'agent_message_chunk' })
    h.tracker.requestCancel('s1')
    vi.advanceTimersByTime(35)

    expect(h.settleTurn).toHaveBeenCalledTimes(1)
    expect(h.settleTurn.mock.calls[0]?.[1]).toMatchObject({ reason: 'cancel', stopReason: 'cancelled' })
  })

  test('取消 + tool 挂死:硬截止强制结算', () => {
    vi.useFakeTimers()
    const h = createHarness()

    h.tracker.handleUnboundFrame('s1', { sessionUpdate: 'tool_call', toolCallId: 't1', status: 'in_progress' })
    h.tracker.requestCancel('s1')
    vi.advanceTimersByTime(35)
    expect(h.settleTurn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(60)
    expect(h.settleTurn).toHaveBeenCalledTimes(1)
    expect(h.settleTurn.mock.calls[0]?.[1]).toMatchObject({ reason: 'cancel', stopReason: 'cancelled' })
  })

  test('disposeSession 结算一次并清空定时器(防泄漏豁免)', () => {
    vi.useFakeTimers()
    const h = createHarness()

    h.tracker.handleUnboundFrame('s1', { sessionUpdate: 'agent_thought_chunk' })
    h.tracker.disposeSession('s1', { stopReason: 'error', error: 'Agent runtime exited' })

    expect(h.settleTurn).toHaveBeenCalledTimes(1)
    expect(h.settleTurn).toHaveBeenCalledWith('s1', {
      messageId: 'auto-1',
      stopReason: 'error',
      error: 'Agent runtime exited',
      reason: 'disposed',
    })
    vi.advanceTimersByTime(5_000)
    expect(h.settleTurn).toHaveBeenCalledTimes(1)
  })

  test('不同会话互不影响', () => {
    vi.useFakeTimers()
    const h = createHarness()

    h.tracker.handleUnboundFrame('s1', { sessionUpdate: 'agent_thought_chunk' })
    h.tracker.handleUnboundFrame('s2', { sessionUpdate: 'agent_thought_chunk' })
    h.tracker.disposeSession('s1', { stopReason: 'cancelled' })

    expect(h.tracker.isOpen('s1')).toBe(false)
    expect(h.tracker.isOpen('s2')).toBe(true)
    expect(h.settleTurn).toHaveBeenCalledTimes(1)
  })
})