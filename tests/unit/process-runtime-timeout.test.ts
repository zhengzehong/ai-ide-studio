import { describe, expect, test } from 'vitest'
import { resolveRuntimeRequestTimeoutMs } from '../../src/runtime/api/process-runtime-port.js'

describe('resolveRuntimeRequestTimeoutMs', () => {
  test('prompt requests have no timeout', () => {
    expect(resolveRuntimeRequestTimeoutMs('prompt', {})).toBeUndefined()
    expect(resolveRuntimeRequestTimeoutMs('prompt', { requestTimeoutMs: 250, forkTimeoutMs: 5_000 })).toBeUndefined()
  })

  test('fork defaults to 5 minutes and is tunable via forkTimeoutMs', () => {
    expect(resolveRuntimeRequestTimeoutMs('fork', {})).toBe(300_000)
    expect(resolveRuntimeRequestTimeoutMs('fork', { forkTimeoutMs: 120_000 })).toBe(120_000)
  })

  test('fork timeout wins over the generic requestTimeoutMs', () => {
    expect(resolveRuntimeRequestTimeoutMs('fork', { requestTimeoutMs: 30_000, forkTimeoutMs: 120_000 })).toBe(120_000)
    expect(resolveRuntimeRequestTimeoutMs('fork', { requestTimeoutMs: 30_000 })).toBe(300_000)
  })

  test('short control requests keep the 30s default and stay tunable', () => {
    for (const operation of ['ensure', 'cancel', 'close-session', 'set-model', 'set-mode', 'set-config'] as const) {
      expect(resolveRuntimeRequestTimeoutMs(operation, {})).toBe(30_000)
      expect(resolveRuntimeRequestTimeoutMs(operation, { requestTimeoutMs: 250 })).toBe(250)
    }
  })
})
