import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { WidgetPinButton } from '../../ui/src/pages/widget/WidgetPinButton.js'

describe('Widget pin button', () => {
  test('exposes a distinct pinned state', () => {
    const html = renderToStaticMarkup(createElement(WidgetPinButton, {
      pinned: true,
      onToggle: vi.fn(),
    }))

    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('widget-icon-button--active')
    expect(html).toContain('取消置顶')
  })

  test('labels the unpinned action clearly', () => {
    const html = renderToStaticMarkup(createElement(WidgetPinButton, {
      pinned: false,
      onToggle: vi.fn(),
    }))

    expect(html).toContain('aria-pressed="false"')
    expect(html).not.toContain('widget-icon-button--active')
    expect(html).toContain('置顶组件')
  })
})
