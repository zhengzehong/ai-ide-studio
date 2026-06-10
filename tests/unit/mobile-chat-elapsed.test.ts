import { describe, expect, test } from 'vitest'
import { deriveLiveElapsedSeconds } from '../../mobile/src/utils/chat-elapsed.ts'
import type { MessageData } from '../../ui/src/stores/session-events.ts'

function message(overrides: Partial<MessageData>): MessageData {
  return {
    id: 'msg-1',
    session_id: 'sess-1',
    role: 'human',
    content: 'hello',
    thinking: null,
    tool_calls_json: null,
    decision_json: null,
    attachments_json: null,
    file_changes_json: null,
    timestamp: '2026-06-10T00:00:00.000Z',
    ...overrides,
  }
}

describe('mobile chat elapsed time', () => {
  test('derives running elapsed seconds from the latest human message in the session', () => {
    const elapsed = deriveLiveElapsedSeconds({
      isRunning: true,
      sessionId: 'sess-1',
      nowMs: Date.parse('2026-06-10T00:01:10.000Z'),
      messages: [
        message({ id: 'old', timestamp: '2026-06-10T00:00:00.000Z' }),
        message({ id: 'other', session_id: 'sess-2', timestamp: '2026-06-10T00:01:00.000Z' }),
        message({ id: 'latest', timestamp: '2026-06-10T00:01:00.000Z' }),
      ],
    })

    expect(elapsed).toBe(10)
  })

  test('returns undefined when the chat is not running or has no valid human timestamp', () => {
    expect(deriveLiveElapsedSeconds({
      isRunning: false,
      sessionId: 'sess-1',
      nowMs: Date.parse('2026-06-10T00:01:10.000Z'),
      messages: [message({ timestamp: '2026-06-10T00:01:00.000Z' })],
    })).toBeUndefined()

    expect(deriveLiveElapsedSeconds({
      isRunning: true,
      sessionId: 'sess-1',
      nowMs: Date.parse('2026-06-10T00:01:10.000Z'),
      messages: [message({ role: 'agent', timestamp: '2026-06-10T00:01:00.000Z' }), message({ timestamp: 'invalid' })],
    })).toBeUndefined()
  })
})
