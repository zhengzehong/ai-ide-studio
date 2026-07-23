import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import TurnContent from '../../mobile/src/components/chat/TurnContent.tsx'
import { normalizeMessage, type MessageData } from '../../ui/src/stores/session-events.ts'

describe('mobile preview presentation history', () => {
  test('renders a persisted preview without loading completed process blocks', () => {
    const message = normalizeMessage({
      id: 'msg-mobile-preview',
      session_id: 'sess-mobile',
      role: 'agent',
      content: 'Done',
      thinking: null,
      tool_calls_json: null,
      decision_json: null,
      presentations_json: JSON.stringify([{
        kind: 'preview',
        previewId: 'prev-mobile',
        url: '/preview/prev-mobile/',
        title: 'Mobile history preview',
        target: 'app',
        taskId: null,
        createdAt: '2026-07-23T00:00:00.000Z',
      }]),
      timestamp: '2026-07-23T00:00:01.000Z',
      status: 'completed',
      process_item_count: 1,
    } as MessageData)

    const html = renderToStaticMarkup(createElement(TurnContent, {
      message,
      isStreaming: false,
      onOpenPreview: () => undefined,
    }))

    expect(html).toContain('Mobile history preview')
  })
})

