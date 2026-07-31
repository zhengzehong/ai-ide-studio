import type { WebPreferences } from 'electron'

export const MAIN_WINDOW_ZOOM_FACTOR = 0.9

export function createMainWindowWebPreferences(preload: string): WebPreferences {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    zoomFactor: MAIN_WINDOW_ZOOM_FACTOR,
  }
}
