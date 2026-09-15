import { describe, expect, it } from 'vitest'
import {
  classifyDataWorkerLatency,
  dataWorkerLatencyComponents,
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

  it('blames the largest component, not the first matching one', () => {
    // 线上实例:9.8s 队列等待曾被固定顺序判定误标成 api_delivery(delivery 只有 451ms)。
    expect(classifyDataWorkerLatency({
      queueWaitMs: 9_844,
      executionMs: 352,
      totalMs: 10_196,
      clientObservedMs: 10_647,
      deliveryLagMs: 451,
    }, 100)).toBe('worker_queue')
    expect(classifyDataWorkerLatency({
      queueWaitMs: 120,
      executionMs: 30,
      totalMs: 900,
      clientObservedMs: 900,
      deliveryLagMs: 750,
    }, 100)).toBe('api_delivery')
  })

  it('surfaces all three latency components for logging', () => {
    expect(dataWorkerLatencyComponents({
      queueWaitMs: 5,
      executionMs: 7,
      totalMs: 12,
      deliveryLagMs: 200,
    })).toEqual({ queueWaitMs: 5, executionMs: 7, deliveryLagMs: 200 })
  })
})
