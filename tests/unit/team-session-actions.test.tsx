import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { TeamSessionActions } from '../../ui/src/components/team/TeamSessionActions'

function render(overrides: Partial<Parameters<typeof TeamSessionActions>[0]> = {}): string {
  return renderToStaticMarkup(createElement(TeamSessionActions, {
    pinned: false,
    canPin: true,
    canMarkUnread: true,
    pendingAction: null,
    onTogglePin: () => undefined,
    onMarkUnread: () => undefined,
    ...overrides,
  }))
}

describe('team conversation header actions', () => {
  test('renders pin and mark-unread as icon buttons in the approved order', () => {
    const html = render()
    expect(html).toContain('aria-label="置顶"')
    expect(html).toContain('aria-label="标记未读"')
    expect(html.indexOf('置顶')).toBeLessThan(html.indexOf('标记未读'))
    expect(html).not.toContain('取消置顶')
  })

  test('shows the pinned state with the unpin affordance and the active highlight', () => {
    const html = render({ pinned: true })
    expect(html).toContain('aria-label="取消置顶"')
    expect(html).toContain('class="is-active"')
  })

  test('disables mark-unread for an empty or archived line and explains why', () => {
    const empty = render({ canMarkUnread: false })
    expect(empty).toContain('disabled')
    expect(empty).toContain('当前会话线没有消息')
    const pinnedButEmpty = render({ canMarkUnread: false })
    // 置顶按钮不受"线内无消息"影响：空线也可以置顶。
    expect(pinnedButEmpty).toContain('aria-label="置顶"')
    expect(pinnedButEmpty.match(/disabled/g)?.length).toBe(1)
  })

  test('locks both buttons while an action is in flight', () => {
    const pinning = render({ pendingAction: 'pin' })
    expect(pinning.match(/disabled/g)?.length).toBe(2)
    const marking = render({ pendingAction: 'unread' })
    expect(marking.match(/disabled/g)?.length).toBe(2)
  })

  test('closes the pin entry for an archived line and explains why', () => {
    const archived = render({ canPin: false, canMarkUnread: false })
    expect(archived.match(/disabled/g)?.length).toBe(2)
    expect(archived).toContain('已归档的会话线不可置顶')
    // 归档线即便曾置顶也不再显示取消置顶的高亮态（入口已关，避免"可取消"的错觉）。
    expect(render({ canPin: false, pinned: true })).not.toContain('class="is-active"')
  })
})
