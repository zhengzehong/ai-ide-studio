import { describe, expect, test, vi } from 'vitest'
import { attachMainWindowExit } from '../../electron/main-window-exit.js'

describe('Electron main window exit', () => {
  test('quits the application when the user closes the main window', () => {
    let closed: (() => void) | undefined
    const clearMainWindow = vi.fn()
    const quitApp = vi.fn()

    attachMainWindowExit({
      on: (_event, listener) => { closed = listener },
    }, {
      clearMainWindow,
      isQuitting: () => false,
      quitApp,
    })

    closed?.()

    expect(clearMainWindow).toHaveBeenCalledOnce()
    expect(quitApp).toHaveBeenCalledOnce()
  })

  test('does not re-enter quit while Electron is already shutting down', () => {
    let closed: (() => void) | undefined
    const quitApp = vi.fn()

    attachMainWindowExit({
      on: (_event, listener) => { closed = listener },
    }, {
      clearMainWindow: vi.fn(),
      isQuitting: () => true,
      quitApp,
    })

    closed?.()

    expect(quitApp).not.toHaveBeenCalled()
  })
})

