import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { TurnContentView } from '../../ui/src/components/chat/TurnContentView.tsx'
import { normalizeMessage, type MessageData } from '../../ui/src/stores/session-events.ts'

const preview = {
  kind: 'preview' as const,
  previewId: 'prev-history',
  url: '/preview/prev-history/',
  title: 'History preview',
  target: 'pc' as const,
  taskId: null,
  createdAt: '2026-07-23T00:00:00.000Z',
}

describe('preview presentation history rendering', () => {
  test('normalizes persisted preview summaries from a completed message', () => {
    const message = normalizeMessage({
      id: 'msg-1',
      session_id: 'sess-1',
      role: 'agent',
      content: 'Done',
      thinking: null,
      tool_calls_json: null,
      decision_json: null,
      presentations_json: JSON.stringify([preview]),
      timestamp: '2026-07-23T00:00:01.000Z',
      status: 'completed',
      process_item_count: 1,
    } as MessageData)

    expect(message.parsedPresentations).toEqual([preview])
  })

  test('renders a persisted preview without completed process blocks', () => {
    const Component = TurnContentView as unknown as ComponentType<Record<string, unknown>>
    const html = renderToStaticMarkup(createElement(Component, {
      processBlocks: [],
      finalAnswer: 'Done',
      isStreaming: false,
      processCount: 1,
      processLoaded: false,
      previewPresentations: [preview],
      renderProcessBlock: () => null,
      renderPreviewPresentation: (item: typeof preview) => createElement('span', null, item.title),
    }))

    expect(html).toContain('History preview')
  })
})

