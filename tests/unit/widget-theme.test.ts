import { describe, expect, test, vi } from 'vitest'
import {
  getNextWidgetTheme,
  readWidgetTheme,
  saveWidgetTheme,
} from '../../ui/src/pages/widget/widget-theme'

describe('Widget theme', () => {
  test('cycles through light, yellow, dark, and back to light', () => {
    expect(getNextWidgetTheme('light')).toBe('yellow')
    expect(getNextWidgetTheme('yellow')).toBe('dark')
    expect(getNextWidgetTheme('dark')).toBe('light')
  })

  test('persists and restores a supported theme', () => {
    const storage = { getItem: vi.fn(() => 'dark'), setItem: vi.fn() }
    expect(readWidgetTheme(storage)).toBe('dark')
    saveWidgetTheme(storage, 'yellow')
    expect(storage.setItem).toHaveBeenCalledWith('ai-ide-widget-theme', 'yellow')
  })

  test('falls back to light when storage is invalid or unavailable', () => {
    expect(readWidgetTheme({ getItem: () => 'unknown', setItem: vi.fn() })).toBe('light')
    expect(readWidgetTheme({ getItem: () => { throw new Error('blocked') }, setItem: vi.fn() })).toBe('light')
  })
})
