import { describe, expect, test } from 'vitest'
import {
  createMainWindowWebPreferences,
  MAIN_WINDOW_ZOOM_FACTOR,
} from '../../electron/desktop-window-settings.js'

describe('Electron desktop window settings', () => {
  test('applies browser-like ninety percent zoom only to the main renderer', () => {
    expect(MAIN_WINDOW_ZOOM_FACTOR).toBe(0.9)
    expect(createMainWindowWebPreferences('C:/electron/desktop-preload.cjs')).toEqual({
      preload: 'C:/electron/desktop-preload.cjs',
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: 0.9,
    })
  })
})
