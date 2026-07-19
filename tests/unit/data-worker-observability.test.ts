import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DATA_WORKER_SLOW_MS,
  isSlowWorkerRequest,
  parseDataWorkerSlowMs,
} from '../../src/data-worker/observability.js'

describe('data worker observability', () => {
  it('parses a positive slow threshold and falls back for invalid values', () => {
    expect(parseDataWorkerSlowMs('250')).toBe(250)
    expect(parseDataWorkerSlowMs('0')).toBe(DEFAULT_DATA_WORKER_SLOW_MS)
    expect(parseDataWorkerSlowMs('-1')).toBe(DEFAULT_DATA_WORKER_SLOW_MS)
    expect(parseDataWorkerSlowMs('invalid')).toBe(DEFAULT_DATA_WORKER_SLOW_MS)
    expect(parseDataWorkerSlowMs(undefined)).toBe(DEFAULT_DATA_WORKER_SLOW_MS)
  })

  it('classifies requests at or above the configured threshold as slow', () => {
    expect(isSlowWorkerRequest({ totalMs: 99 }, 100)).toBe(false)
    expect(isSlowWorkerRequest({ totalMs: 100 }, 100)).toBe(true)
  })
})
