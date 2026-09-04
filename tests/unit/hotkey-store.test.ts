import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useHotkeyStore, HOTKEY_STORAGE_KEY } from '../../ui/src/stores/hotkey.store.js'

describe('hotkey store', () => {
  const storage = new Map<string, string>()
  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('localStorage', {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    })
    useHotkeyStore.setState({ overrides: {}, lastConflict: [] })
  })

  test('persists overrides and supports null as disabled', () => {
    expect(useHotkeyStore.getState().setOverride('session.next', 'alt+n').ok).toBe(true)
    expect(useHotkeyStore.getState().setOverride('session.prev', null).ok).toBe(true)
    expect(JSON.parse(localStorage.getItem(HOTKEY_STORAGE_KEY) ?? '{}')).toEqual({ version: 1, overrides: { 'session.next': 'alt+n', 'session.prev': null } })
  })

  test('rejects malformed binding and resets all overrides', () => {
    expect(useHotkeyStore.getState().setOverride('session.next', 'a b c').ok).toBe(false)
    useHotkeyStore.getState().setOverride('session.next', 'alt+n')
    useHotkeyStore.getState().resetAll()
    expect(useHotkeyStore.getState().overrides).toEqual({})
  })
})
