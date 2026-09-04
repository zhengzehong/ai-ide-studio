import { beforeEach, describe, expect, test, vi } from 'vitest'
import { HOTKEY_ACTIONS } from '../../ui/src/lib/hotkey-actions.js'
import { applyBindingChange, effectiveBinding, findConflicts } from '../../ui/src/lib/hotkey-registry.js'
import { normalizeBinding, isValidBinding } from '../../ui/src/lib/platform-key.js'

describe('hotkey registry', () => {
  beforeEach(() => vi.stubGlobal('localStorage', { clear: () => undefined }))

  test('normalizes platform modifier and chord bindings', () => {
    expect(normalizeBinding('G I')).toBe('g i')
    expect(normalizeBinding('Ctrl+Shift+]')).toBe('mod+shift+]')
    expect(isValidBinding('g i')).toBe(true)
    expect(isValidBinding('g i d')).toBe(false)
  })

  test('resolves overrides before defaults and detects same-scope conflicts', () => {
    const action = HOTKEY_ACTIONS.find((item) => item.id === 'session.next')!
    expect(effectiveBinding(action, {})).toBe('j')
    const conflicts = findConflicts('session.next', 'k', {})
    expect(conflicts.some((item) => item.id === 'session.prev')).toBe(true)
  })

  test('returns a conflict action to default when a binding is taken', () => {
    const result = applyBindingChange('session.next', 'alt+n', { 'session.prev': 'alt+n' })
    expect(result.unresolved).toHaveLength(0)
    expect(result.overrides['session.next']).toBe('alt+n')
    expect(result.overrides['session.prev']).toBeUndefined()
    expect(result.conflicts.some((item) => item.id === 'session.prev')).toBe(true)
  })
})
