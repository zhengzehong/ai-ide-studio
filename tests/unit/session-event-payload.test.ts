import { describe, expect, test } from 'vitest'
import { eventPayloadFromUpdate } from '../../src/core/session-event-payload.js'

describe('session event payload', () => {
  test('persists file paths without duplicating complete diff text', () => {
    const payload = eventPayloadFromUpdate({
      messageId: 'message-1',
      role: 'agent',
      toolCallUpdate: {
        id: 'tool-1',
        title: 'Edit file',
        status: 'completed',
        content: [{
          type: 'diff',
          path: 'src/app.ts',
          oldText: 'old secret content',
          newText: 'new secret content',
        }],
      },
    })
    const serialized = JSON.stringify(payload)

    expect(serialized).toContain('src/app.ts')
    expect(serialized).not.toContain('old secret content')
    expect(serialized).not.toContain('new secret content')
  })
})
