import { describe, expect, test } from 'vitest'
import { isNearBottom, nextPinnedToBottom } from '../../ui/src/components/chat/auto-scroll.ts'

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
