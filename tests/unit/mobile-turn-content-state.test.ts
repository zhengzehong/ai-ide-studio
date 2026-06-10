import { describe, expect, test } from 'vitest'
import { resolveProcessOpen } from '../../mobile/src/components/chat/TurnContent.tsx'

describe('mobile turn content state', () => {
  test('opens streaming process by default until the user closes it', () => {
    expect(resolveProcessOpen(true, null)).toBe(true)
    expect(resolveProcessOpen(true, 'closed')).toBe(false)
  })

  test('keeps completed process collapsed by default until the user opens it', () => {
    expect(resolveProcessOpen(false, null)).toBe(false)
    expect(resolveProcessOpen(false, 'open')).toBe(true)
  })
})
