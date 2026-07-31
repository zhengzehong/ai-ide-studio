import { beforeEach, describe, expect, test, vi } from 'vitest'

const windows: FakeBrowserWindow[] = []

class FakeBrowserWindow {
  private alwaysOnTop = true
  readonly options: unknown

  constructor(options: unknown) {
    this.options = options
    windows.push(this)
  }

  loadURL = vi.fn()
  on = vi.fn()
  isDestroyed = vi.fn(() => false)
  isAlwaysOnTop = vi.fn(() => this.alwaysOnTop)
  setAlwaysOnTop = vi.fn((value: boolean) => { this.alwaysOnTop = value })
  getBounds = vi.fn(() => ({ x: 0, y: 0, width: 300, height: 360 }))
  hide = vi.fn()
  show = vi.fn()
  isVisible = vi.fn(() => true)
}

vi.mock('electron', () => ({
  BrowserWindow: FakeBrowserWindow,
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
}))

const { createWidgetWindow, isWidgetPinned, toggleWidgetPin } = await import('../../electron/widget-window.js')

beforeEach(() => {
  windows.length = 0
})

describe('Electron Widget pin state', () => {
  test('reports the initial always-on-top state and returns each toggled state', () => {
    createWidgetWindow({
      target: {
        mode: 'remote',
        origin: 'http://127.0.0.1:18800',
        token: 'token',
        ownsBackend: false,
        widgetEnabled: true,
      },
      electronDir: 'C:/electron',
      userDataDir: 'C:/data',
      iconPath: 'C:/resources/app-icon.png',
    })

    expect(isWidgetPinned()).toBe(true)
    expect(toggleWidgetPin()).toBe(false)
    expect(isWidgetPinned()).toBe(false)
    expect(toggleWidgetPin()).toBe(true)
    expect(windows[0]?.setAlwaysOnTop).toHaveBeenNthCalledWith(1, false)
    expect(windows[0]?.setAlwaysOnTop).toHaveBeenNthCalledWith(2, true)
    expect(windows[0]?.options).toMatchObject({ icon: 'C:/resources/app-icon.png' })
    expect(windows[0]?.options).toMatchObject({ width: 300, height: 360, x: 1600, y: 700 })
  })
})

