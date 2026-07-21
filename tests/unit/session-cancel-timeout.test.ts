import { describe, expect, test } from 'vitest'
import { shouldForceRuntimeCancel } from '../../src/runtime/api/runtime-cancel-watchdog.js'

describe('session cancel timeout', () => {
  test('forces completion only when cancel timed out and the prompt remains active', () => {
    expect(shouldForceRuntimeCancel(false, true)).toBe(true)
    expect(shouldForceRuntimeCancel(true, true)).toBe(false)
    expect(shouldForceRuntimeCancel(false, false)).toBe(false)
  })
})
