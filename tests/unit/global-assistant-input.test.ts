import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { GlobalAssistantInput } from '../../ui/src/components/global-assistant/GlobalAssistantInput.tsx'
import { defaultCaps } from '../../ui/src/stores/session-events.ts'

function renderInput(input: { streaming: boolean; stopping: boolean; stopError?: string | null }): string {
  return renderToStaticMarkup(createElement(GlobalAssistantInput, {
    connected: true,
    blocked: false,
    streaming: input.streaming,
    stopping: input.stopping,
    stopError: input.stopError ?? null,
    capabilities: { ...defaultCaps },
    usage: null,
    onSend: vi.fn(async () => undefined),
    onCancel: vi.fn(async () => undefined),
    onSetModel: vi.fn(async () => undefined),
    onSetMode: vi.fn(async () => undefined),
    onSetConfig: vi.fn(async () => undefined),
  }))
}

describe('GlobalAssistantInput stopping state', () => {
  test('keeps the composer editable and renders explicit stopping feedback', () => {
    const html = renderInput({ streaming: true, stopping: true })

    expect(html).toContain('正在停止')
    expect(html).not.toMatch(/<textarea[^>]*disabled/)
    expect(html).toContain('title="停止处理中"')
    expect(html).toContain('title="发送"')
  })

  test('keeps the composer disabled before cancellation is requested', () => {
    const html = renderInput({ streaming: true, stopping: false })

    expect(html).toMatch(/<textarea[^>]*disabled/)
    expect(html).not.toContain('正在停止')
  })

  test('shows a cancellation error returned by the store', () => {
    const html = renderInput({ streaming: true, stopping: false, stopError: '停止失败：连接中断' })

    expect(html).toContain('停止失败：连接中断')
  })
})
