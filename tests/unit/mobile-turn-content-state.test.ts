import { describe, expect, test } from 'vitest'
import {
  deriveTurnElapsedSeconds,
  markdownListStyle,
  resolveProcessOpen,
} from '../../mobile/src/components/chat/TurnContent.tsx'

describe('mobile turn content state', () => {
  test('opens streaming process by default until the user closes it', () => {
    expect(resolveProcessOpen(true, null)).toBe(true)
    expect(resolveProcessOpen(true, 'closed')).toBe(false)
  })

  test('keeps completed process collapsed by default until the user opens it', () => {
    expect(resolveProcessOpen(false, null)).toBe(false)
    expect(resolveProcessOpen(false, 'open')).toBe(true)
  })

  test('derives completed elapsed time from message timestamps when stats omit it', () => {
    expect(deriveTurnElapsedSeconds({
      isStreaming: false,
      liveElapsedSeconds: undefined,
      turnStats: { inputTokens: 1000, outputTokens: 400 },
      message: {
        started_at: '2026-06-10T00:00:00.000Z',
        completed_at: '2026-06-10T00:00:12.000Z',
      },
    })).toBe(12)
  })

  test('uses compact markdown list indentation inside mobile bubbles', () => {
    expect(markdownListStyle).toMatchObject({
      margin: '4px 0',
      paddingInlineStart: 18,
    })
  })
})
