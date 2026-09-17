import { describe, expect, test } from 'vitest'
import { resolveTerminalAttribution } from '../../src/core/terminal-attribution.js'

describe('resolveTerminalAttribution', () => {
  test('matching ids: event id wins and both content sources stay usable', () => {
    const result = resolveTerminalAttribution({
      eventMessageId: 'msg-turn-a',
      processMessageId: 'msg-turn-a',
      hasPendingContent: true,
      pendingMessageId: 'msg-turn-a',
    })
    expect(result).toEqual({
      messageId: 'msg-turn-a',
      mismatch: false,
      useProcessContent: true,
      usePendingContent: true,
    })
  })

  test('sess-d83044f2 regression: autonomous terminal must not be attributed to the running real turn', () => {
    // 合成(后台唤醒)回合被 dispose 时:事件 messageId=auto-*,但活跃执行过程已经是刚启动的真回合。
    const result = resolveTerminalAttribution({
      eventMessageId: 'auto-1',
      processMessageId: 'msg-turn-real',
      hasPendingContent: true,
      pendingMessageId: 'auto-1',
    })
    expect(result.messageId).toBe('auto-1')
    expect(result.mismatch).toBe(true)
    expect(result.useProcessContent).toBe(false)
    expect(result.usePendingContent).toBe(true)
  })

  test('cross-turn pending aggregation is not allowed to spill onto the terminal row', () => {
    const result = resolveTerminalAttribution({
      eventMessageId: 'msg-turn-b',
      processMessageId: 'msg-turn-b',
      hasPendingContent: true,
      pendingMessageId: 'auto-older-turn',
    })
    expect(result.messageId).toBe('msg-turn-b')
    expect(result.mismatch).toBe(false)
    expect(result.useProcessContent).toBe(true)
    expect(result.usePendingContent).toBe(false)
  })

  test('no active process: pending content is used when the id matches or is absent', () => {
    const withId = resolveTerminalAttribution({
      eventMessageId: 'auto-9',
      hasPendingContent: true,
      pendingMessageId: 'auto-9',
    })
    expect(withId).toEqual({
      messageId: 'auto-9',
      mismatch: false,
      useProcessContent: false,
      usePendingContent: true,
    })

    const withoutId = resolveTerminalAttribution({
      eventMessageId: 'auto-9',
      hasPendingContent: true,
    })
    expect(withoutId.usePendingContent).toBe(true)
    expect(withoutId.mismatch).toBe(false)
  })

  test('no pending content at all', () => {
    const result = resolveTerminalAttribution({ eventMessageId: 'msg-1', hasPendingContent: false })
    expect(result).toEqual({
      messageId: 'msg-1',
      mismatch: false,
      useProcessContent: false,
      usePendingContent: false,
    })
  })
})
