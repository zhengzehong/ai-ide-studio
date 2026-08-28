import { describe, expect, it } from 'vitest'
import {
  classifyDataWorkerLatency,
  DEFAULT_DATA_WORKER_SLOW_MS,
  isSlowWorkerRequest,
  parseDataWorkerSlowMs,
} from '../../src/data-worker/observability.js'

describe('data worker latency attribution', () => {
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
    expect(isSlowWorkerRequest({ totalMs: 10, clientObservedMs: 500 }, 100)).toBe(true)
  })

  it('identifies API callback delay after fast Worker execution', () => {
    expect(classifyDataWorkerLatency({
      queueWaitMs: 0,
      executionMs: 4,
      totalMs: 4,
      clientObservedMs: 1_841,
      deliveryLagMs: 1_837,
    }, 100)).toBe('api_delivery')
  })

  it('distinguishes Worker execution from Worker queue wait', () => {
    expect(classifyDataWorkerLatency({
      queueWaitMs: 0,
      executionMs: 471,
      totalMs: 479,
      clientObservedMs: 487,
      deliveryLagMs: 8,
    }, 100)).toBe('worker_execution')
    expect(classifyDataWorkerLatency({
      queueWaitMs: 445,
      executionMs: 49,
      totalMs: 494,
      clientObservedMs: 498,
      deliveryLagMs: 4,
    }, 100)).toBe('worker_queue')
  })
})
