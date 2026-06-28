import { describe, expect, test } from 'vitest'
import { elapsedSecondsBetween, formatCompactDuration } from '../../ui/src/utils/duration.ts'

describe('formatCompactDuration', () => {
  test('formats seconds', () => {
    expect(formatCompactDuration(0)).toBe('0s')
    expect(formatCompactDuration(59)).toBe('59s')
  })

  test('formats minutes and seconds under one hour', () => {
    expect(formatCompactDuration(60)).toBe('1m')
    expect(formatCompactDuration(123)).toBe('2m3s')
    expect(formatCompactDuration(600)).toBe('10m')
  })

  test('formats hours without seconds', () => {
    expect(formatCompactDuration(3600)).toBe('1h')
    expect(formatCompactDuration(3723)).toBe('1h2m')
    expect(formatCompactDuration(7320)).toBe('2h2m')
  })

  test('formats days for very long runs', () => {
    expect(formatCompactDuration(86400)).toBe('1d')
    expect(formatCompactDuration(93600)).toBe('1d2h')
  })
})

describe('elapsedSecondsBetween', () => {
  test('computes rounded elapsed seconds between ISO timestamps', () => {
    expect(elapsedSecondsBetween('2026-06-05T00:00:00.000Z', '2026-06-05T00:02:03.400Z')).toBe(123)
  })

  test('ignores incomplete or invalid timestamp pairs', () => {
    expect(elapsedSecondsBetween(null, '2026-06-05T00:00:01.000Z')).toBeUndefined()
    expect(elapsedSecondsBetween('bad', '2026-06-05T00:00:01.000Z')).toBeUndefined()
    expect(elapsedSecondsBetween('2026-06-05T00:00:02.000Z', '2026-06-05T00:00:01.000Z')).toBeUndefined()
  })
})
