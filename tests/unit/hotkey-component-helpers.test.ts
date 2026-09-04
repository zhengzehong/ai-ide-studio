import { describe, expect, test } from 'vitest'
import { composeRecordedBinding, filterHotkeyActions, resolvePinnedProjectId } from '../../ui/src/lib/hotkey-component-helpers.js'

describe('shortcut component helpers', () => {
  test('composes recorded single keys and G chords', () => {
    expect(composeRecordedBinding(null, 'alt+n')).toBe('alt+n')
    expect(composeRecordedBinding('g', 'i')).toBe('g i')
  })

  test('filters stale pinned project IDs before indexing', () => {
    expect(resolvePinnedProjectId(['missing', 'p2', 'p3'], ['p2', 'p3'], 0)).toBe('p2')
    expect(resolvePinnedProjectId(['missing'], ['p2'], 0)).toBeNull()
  })

  test('filters actions by ID, label, and keywords', () => {
    expect(filterHotkeyActions('灵感').some((action) => action.id === 'page.inspiration')).toBe(true)
    expect(filterHotkeyActions('does-not-exist')).toHaveLength(0)
  })
})
