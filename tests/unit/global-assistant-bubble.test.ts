import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { GlobalChatBubble } from '../../ui/src/components/global-assistant/GlobalAssistantBubble.tsx'

describe('GlobalChatBubble', () => {
  test('shows completed final answer before lazy process items are loaded', () => {
    const html = renderToStaticMarkup(
      createElement(GlobalChatBubble, {
        message: {
          id: 'msg-agent',
          session_id: 'sess-global',
          role: 'agent',
          content: 'Final answer text',
          thinking: null,
          tool_calls_json: null,
          decision_json: null,
          attachments_json: null,
          file_changes_json: null,
          timestamp: '2026-06-12T00:00:00.000Z',
          process_item_count: 3,
        },
        agentName: 'Global',
        agentColorValue: '#3478f6',
        isStreaming: false,
        onLoadMessageProcess: () => undefined,
        onLoadMessageFileChanges: () => undefined,
        onLoadProcessItemDetail: () => undefined,
        fileChangeDetailsByMessageId: {},
        fileChangeLoadingByKey: {},
        fileChangeErrorByKey: {},
        processItemLoadingByKey: {},
        processItemErrorByKey: {},
        turnProcessLoadingByMessageId: {},
        turnProcessErrorByMessageId: {},
      }),
    )

    expect(html).toContain('Final answer text')
  })
})
