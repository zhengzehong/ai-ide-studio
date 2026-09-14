import { describe, expect, test } from 'vitest'
import { isNearBottom, nextPinnedToBottom, resolveScrollFollow, streamingScrollSignature } from '../../ui/src/components/chat/auto-scroll.ts'

describe('chat auto scroll helpers', () => {
  test('treats the viewport as pinned when it is within the bottom threshold', () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 720, clientHeight: 180 })).toBe(true)
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 180 })).toBe(false)
  })

  test('keeps streaming pinned while content grows beyond the threshold', () => {
    const pinned = nextPinnedToBottom({
      wasPinned: true,
      previousScrollHeight: 1000,
      metrics: { scrollHeight: 1400, scrollTop: 720, clientHeight: 180 },
    })

    expect(pinned).toBe(true)
  })

  test('does not force-scroll after the user intentionally scrolled away', () => {
    const pinned = nextPinnedToBottom({
      wasPinned: false,
      previousScrollHeight: 1000,
      metrics: { scrollHeight: 1400, scrollTop: 720, clientHeight: 180 },
    })

    expect(pinned).toBe(false)
  })
})

describe('resolveScrollFollow（切回会话滚动跟随修复）', () => {
  const base = {
    pinned: true,
    grace: false,
    manual: false,
    metrics: { scrollHeight: 2000, scrollTop: 1000, clientHeight: 500 }, // 距底 500px
    previousScrollHeight: 2000,
    previousScrollTop: 1000,
  }

  test('增长豁免：内容增长导致离底 500px，不算离开底部（切回恢复合并场景）', () => {
    const decision = resolveScrollFollow({ ...base, metrics: { scrollHeight: 2500, scrollTop: 1000, clientHeight: 500 } })
    expect(decision.pinned).toBe(true)
  })

  test('未 pinned 且内容再增长也不回追（尊重用户阅读历史）', () => {
    const decision = resolveScrollFollow({ ...base, pinned: false, metrics: { scrollHeight: 2500, scrollTop: 1000, clientHeight: 500 } })
    expect(decision.pinned).toBe(false)
  })

  test('用户手动滚动（wheel/touch/pointer 后的首个滚动事件）立即解除跟随，并清除宽限', () => {
    const decision = resolveScrollFollow({ ...base, manual: true, grace: true })
    expect(decision.pinned).toBe(false)
    expect(decision.grace).toBe(false)
  })

  test('滚动条拖拽等无 wheel 事件的上行滚动（scrollTop 减小）同样视为用户意图解除', () => {
    const decision = resolveScrollFollow({ ...base, metrics: { scrollHeight: 2500, scrollTop: 700, clientHeight: 500 }, previousScrollTop: 1000 })
    expect(decision.pinned).toBe(false)
  })

  test('初始定位宽限内高度剧变不降级 pinned（挂载/切回竞态窗口）', () => {
    const decision = resolveScrollFollow({ ...base, grace: true, metrics: { scrollHeight: 3200, scrollTop: 1000, clientHeight: 500 } })
    expect(decision.pinned).toBe(true)
    expect(decision.grace).toBe(true)
  })

  test('宽限内追到贴底：保持跟随并提前解除宽限', () => {
    const decision = resolveScrollFollow({ ...base, grace: true, metrics: { scrollHeight: 1560, scrollTop: 1000, clientHeight: 500 } }) // 距底 60
    expect(decision).toEqual({ pinned: true, grace: false })
  })

  test('已 unpinned 后 scrollTop 继续上移：维持 false（不复活跟随）', () => {
    const decision = resolveScrollFollow({ ...base, pinned: false, metrics: { scrollHeight: 1800, scrollTop: 400, clientHeight: 500 } })
    expect(decision.pinned).toBe(false)
  })
})

describe('streamingScrollSignature（工具长跑跟随，#4）', () => {
  const turn = (overrides: Record<string, unknown> = {}) => ({
    id: 'turn-1', content: '', thinking: '', processBlocks: [], toolCalls: [], ...overrides,
  })

  test('末个工具 terminalOutput 增长即可改变签名（无新 chunk 也触发跟随）', () => {
    const before = streamingScrollSignature([turn({ toolCalls: [{ id: 'tool-1', status: 'in_progress', terminalOutput: 'x'.repeat(10) }] })])
    const after = streamingScrollSignature([turn({ toolCalls: [{ id: 'tool-1', status: 'in_progress', terminalOutput: 'x'.repeat(1010) }] })])
    expect(after).not.toBe(before)
  })

  test('工具状态与进度增长同样进入签名', () => {
    const base = streamingScrollSignature([turn({ toolCalls: [{ id: 'tool-1', status: 'in_progress', progress: ['a'] }] })])
    expect(streamingScrollSignature([turn({ toolCalls: [{ id: 'tool-1', status: 'completed', progress: ['a'] }] })])).not.toBe(base)
    expect(streamingScrollSignature([turn({ toolCalls: [{ id: 'tool-1', status: 'in_progress', progress: ['a', 'b'] }] })])).not.toBe(base)
  })

  test('无变化输入签名稳定（避免无谓追底）', () => {
    const value = turn({ content: '正文', toolCalls: [{ id: 'tool-1', terminalOutput: 'out' }] })
    expect(streamingScrollSignature([value])).toBe(streamingScrollSignature([{ ...value, toolCalls: [{ id: 'tool-1', terminalOutput: 'out' }] }]))
  })
})
