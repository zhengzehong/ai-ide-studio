import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { ConversationProcessBlock } from '../../ui/src/components/chat/ConversationProcessBlock'
import {
  resolveProcessThinkingOpen,
  resolveProcessThinkingOverride,
} from '../../ui/src/components/chat/process-detail'

describe('conversation process block disclosure', () => {
  test('keeps completed thinking collapsed by default', () => {
    const html = renderToStaticMarkup(createElement(ConversationProcessBlock, {
      block: { id: 'thinking-complete', kind: 'thinking', text: '仅展开后可见的推理正文' },
      isStreaming: false,
    }))

    expect(html).toContain('思考过程')
    expect(html).not.toContain('仅展开后可见的推理正文')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toMatch(/aria-controls="([^"]+)"/)
  })

  test('shows thinking while the response is streaming', () => {
    const html = renderToStaticMarkup(createElement(ConversationProcessBlock, {
      block: { id: 'thinking-streaming', kind: 'thinking', text: '正在生成的推理正文' },
      isStreaming: true,
    }))

    expect(html).toContain('思考过程')
    expect(html).toContain('正在生成的推理正文')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toMatch(/aria-controls="([^"]+)"/)
    expect(html).toMatch(/id="([^"]+)"/)
  })

  test('renders an intermediate note as full markdown without an inner disclosure button', () => {
    const html = renderToStaticMarkup(createElement(ConversationProcessBlock, {
      block: { id: 'note', kind: 'note', text: '**关键说明**\n\n下一步继续检查。' },
      isStreaming: false,
    }))

    expect(html).toContain('中间说明')
    expect(html).toContain('<strong>关键说明</strong>')
    expect(html).toContain('下一步继续检查。')
    expect(html).not.toContain('<button')
  })

  test('keeps a manual close while streaming and closes an open block when streaming completes', () => {
    const manualClose = { isStreaming: true, value: 'closed' as const }
    const manualOpen = { isStreaming: true, value: 'open' as const }

    expect(resolveProcessThinkingOpen(true, null)).toBe(true)
    expect(resolveProcessThinkingOverride(true, manualClose)).toBe('closed')
    expect(resolveProcessThinkingOpen(true, resolveProcessThinkingOverride(true, manualClose))).toBe(false)
    expect(resolveProcessThinkingOverride(false, manualOpen)).toBeNull()
    expect(resolveProcessThinkingOpen(false, resolveProcessThinkingOverride(false, manualOpen))).toBe(false)
  })

  test('keeps a visible keyboard focus treatment for process disclosure buttons', () => {
    const css = readFileSync(new URL('../../ui/src/index.css', import.meta.url), 'utf8')

    expect(css).toContain('.process-thinking-toggle:focus-visible')
  })
})
