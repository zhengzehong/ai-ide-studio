import { describe, expect, test, vi } from 'vitest'
import {
  createMainWindowPresentation,
  navigateMainWindow,
} from '../../electron/main-window-navigation.js'

function createNavigationWindow(input?: { url?: string; loading?: boolean }) {
  return {
    webContents: {
      getURL: vi.fn(() => input?.url ?? 'https://studio.example/p/project/workspace'),
      isLoadingMainFrame: vi.fn(() => input?.loading ?? false),
      send: vi.fn(),
    },
    loadURL: vi.fn(async () => undefined),
  }
}

describe('Electron main window navigation', () => {
  test('uses renderer navigation without reloading a ready main window', async () => {
    const window = createNavigationWindow()
    const requestRendererNavigation = vi.fn(async () => undefined)

    await expect(navigateMainWindow(
      window,
      'https://studio.example',
      '/p/project/workspace?sessionId=session-1',
      requestRendererNavigation,
    )).resolves.toBe('renderer')

    expect(requestRendererNavigation).toHaveBeenCalledWith('/p/project/workspace?sessionId=session-1')
    expect(window.webContents.send).not.toHaveBeenCalled()
    expect(window.loadURL).not.toHaveBeenCalled()
  })

  test('falls back to reload when renderer navigation is not acknowledged', async () => {
    const window = createNavigationWindow()

    await expect(navigateMainWindow(
      window,
      'https://studio.example',
      '/p/project/workspace?sessionId=session-1',
      async () => { throw new Error('navigation timeout') },
    )).resolves.toBe('reload')

    expect(window.loadURL).toHaveBeenCalledWith(
      'https://studio.example/p/project/workspace?sessionId=session-1',
    )
  })

  test('reloads only when the renderer is not ready', async () => {
    const window = createNavigationWindow({ loading: true })

    await expect(navigateMainWindow(
      window,
      'https://studio.example',
      '/p/project/workspace?sessionId=session-1',
    )).resolves.toBe('reload')

    expect(window.webContents.send).not.toHaveBeenCalled()
    expect(window.loadURL).toHaveBeenCalledWith(
      'https://studio.example/p/project/workspace?sessionId=session-1',
    )
  })
})

describe('Electron main window presentation', () => {
  test('restores a minimized window and reapplies its tracked maximized state', () => {
    const listeners = new Map<string, () => void>()
    const window = {
      on: vi.fn((event: string, listener: () => void) => { listeners.set(event, listener) }),
      isMaximized: vi.fn(() => false),
      isFullScreen: vi.fn(() => false),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      maximize: vi.fn(),
      setFullScreen: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    }
    const presentation = createMainWindowPresentation(window)
    listeners.get('maximize')?.()

    presentation.showAndFocus()

    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.maximize).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  test('reapplies full-screen state before focusing', () => {
    const listeners = new Map<string, () => void>()
    const window = {
      on: vi.fn((event: string, listener: () => void) => { listeners.set(event, listener) }),
      isMaximized: vi.fn(() => false),
      isFullScreen: vi.fn(() => false),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      maximize: vi.fn(),
      setFullScreen: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    }
    const presentation = createMainWindowPresentation(window)
    listeners.get('enter-full-screen')?.()

    presentation.showAndFocus()

    expect(window.setFullScreen).toHaveBeenCalledWith(true)
    expect(window.maximize).not.toHaveBeenCalled()
  })
})
