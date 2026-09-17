import { describe, expect, test } from 'vitest'
import { resolveTerminalAttribution } from '../../src/core/terminal-attribution.js'

/**
 * 终帧归属四场景契约(2026-09-17 sess-d83044f2 事故 + 双审修复轮):
 * ① 事故:auto-* 自带内容 → 事件 id 赢;② 异 id done + 无活跃过程 → 信任 pending;
 * ③ 事件 id 无对应行 + 有活跃过程(exit- 与 done- 前缀的合成 id)→ 回落真实行,禁幽灵行;
 * ④ 迟到 done → 事件 id 赢,新回合聚合不外溢。
 */
describe('resolveTerminalAttribution', () => {
  test('normal turn: matching ids, event id wins and both content sources stay usable', () => {
    const result = resolveTerminalAttribution({
      eventMessageId: 'msg-turn-a',
      processMessageId: 'msg-turn-a',
      hasPendingContent: true,
      pendingMessageId: 'msg-turn-a',
      eventRowExists: true,
    })
    expect(result).toEqual({
      messageId: 'msg-turn-a',
      mismatch: false,
      source: 'event',
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
      eventRowExists: false,
    })
    expect(result.messageId).toBe('auto-1')
    expect(result.mismatch).toBe(true)
    expect(result.source).toBe('event')
    expect(result.useProcessContent).toBe(false)
    expect(result.usePendingContent).toBe(true)
  })

  test('synthetic done id without active process: streamed pending row is trusted (integration contract)', () => {
    // session-done-error.test.ts:done 携带 `done-${sessionId}`(无对应行),唯一内容在流式聚合里。
    const result = resolveTerminalAttribution({
      eventMessageId: 'done-sess-1',
      processMessageId: undefined,
      hasPendingContent: true,
      pendingMessageId: 'msg-live-turn-1',
      eventRowExists: false,
    })
    expect(result.messageId).toBe('msg-live-turn-1')
    expect(result.source).toBe('pending')
    expect(result.mismatch).toBe(false)
    expect(result.usePendingContent).toBe(true)
    expect(result.useProcessContent).toBe(false)
  })

  test('B1 regression: process-exit terminal id falls back to the real running row, never a ghost row', () => {
    // exit-* 合成 id 无对应行且真回合仍活跃 → 归属真实行(而非新建 exit-* 幽灵行)。
    const withoutPending = resolveTerminalAttribution({
      eventMessageId: 'exit-1789608680000',
      processMessageId: 'msg-real-turn',
      hasPendingContent: false,
      eventRowExists: false,
    })
    expect(withoutPending.messageId).toBe('msg-real-turn')
    expect(withoutPending.source).toBe('process')
    expect(withoutPending.mismatch).toBe(true)
    expect(withoutPending.useProcessContent).toBe(true)
    expect(withoutPending.usePendingContent).toBe(false)

    // 待终稿聚合若同样属于该真回合,内容可以并用;归属行不变。
    const withPending = resolveTerminalAttribution({
      eventMessageId: 'exit-1789608680000',
      processMessageId: 'msg-real-turn',
      hasPendingContent: true,
      pendingMessageId: 'msg-real-turn',
      eventRowExists: false,
    })
    expect(withPending.messageId).toBe('msg-real-turn')
    expect(withPending.source).toBe('process')
    expect(withPending.useProcessContent).toBe(true)
    expect(withPending.usePendingContent).toBe(true)
  })

  test('late done for an existing old row: event id wins, new turn aggregations do not spill', () => {
    const result = resolveTerminalAttribution({
      eventMessageId: 'msg-old-turn',
      processMessageId: 'msg-turn-b',
      hasPendingContent: true,
      pendingMessageId: 'msg-turn-b',
      eventRowExists: true,
    })
    expect(result.messageId).toBe('msg-old-turn')
    expect(result.source).toBe('event')
    expect(result.mismatch).toBe(true)
    expect(result.useProcessContent).toBe(false)
    expect(result.usePendingContent).toBe(false)
  })

  test('cross-turn pending aggregation is not allowed to spill onto the terminal row', () => {
    const result = resolveTerminalAttribution({
      eventMessageId: 'msg-turn-b',
      processMessageId: 'msg-turn-b',
      hasPendingContent: true,
      pendingMessageId: 'auto-older-turn',
      eventRowExists: true,
    })
    expect(result.messageId).toBe('msg-turn-b')
    expect(result.source).toBe('event')
    expect(result.mismatch).toBe(false)
    expect(result.useProcessContent).toBe(true)
    expect(result.usePendingContent).toBe(false)
  })

  test('no active process: pending content is used when the id matches or is absent', () => {
    const withId = resolveTerminalAttribution({
      eventMessageId: 'auto-9',
      hasPendingContent: true,
      pendingMessageId: 'auto-9',
      eventRowExists: false,
    })
    expect(withId).toEqual({
      messageId: 'auto-9',
      mismatch: false,
      source: 'event',
      useProcessContent: false,
      usePendingContent: true,
    })

    const withoutId = resolveTerminalAttribution({
      eventMessageId: 'auto-9',
      hasPendingContent: true,
      eventRowExists: false,
    })
    expect(withoutId.messageId).toBe('auto-9')
    expect(withoutId.usePendingContent).toBe(true)
    expect(withoutId.mismatch).toBe(false)
  })

  test('no pending content at all', () => {
    const result = resolveTerminalAttribution({
      eventMessageId: 'msg-1',
      hasPendingContent: false,
      eventRowExists: true,
    })
    expect(result).toEqual({
      messageId: 'msg-1',
      mismatch: false,
      source: 'event',
      useProcessContent: false,
      usePendingContent: false,
    })
  })

  test('nothing left to attribute: unknown id stays as-is (finalizer keeps the old skip behavior)', () => {
    const result = resolveTerminalAttribution({
      eventMessageId: 'done-orphan',
      hasPendingContent: false,
      eventRowExists: false,
    })
    expect(result.messageId).toBe('done-orphan')
    expect(result.source).toBe('event')
  })
})
