import { describe, expect, test } from 'vitest'
import { shouldHandleInteractiveSignal } from '../../src/shared/process-signal-ownership.js'

describe('supervised process signal ownership', () => {
  test('leaves interactive shutdown to the parent while IPC is connected', () => {
    expect(shouldHandleInteractiveSignal(true)).toBe(false)
  })

  test('allows a standalone process to handle interactive shutdown', () => {
    expect(shouldHandleInteractiveSignal(false)).toBe(true)
  })
})
