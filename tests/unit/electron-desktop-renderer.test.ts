import { describe, expect, test, vi } from 'vitest'
import {
  initializeDesktopRendererConnection,
  subscribeDesktopNavigation,
  type ElectronDesktopBridge,
} from '../../ui/src/services/electron-desktop'

describe('Electron desktop renderer bootstrap', () => {
  test('stores desktop auth before UI bootstrap and removes it from the visible URL', () => {
    const bridge = {
      getBootstrap: () => ({
        mode: 'remote' as const,
        origin: 'https://ide.example.com',
        token: 'remote-token',
        widgetEnabled: true,
      }),
    } as ElectronDesktopBridge
    const storage = { setItem: vi.fn() } as unknown as Storage
    const browserHistory = { state: null, replaceState: vi.fn() } as unknown as History
    const location = new URL('https://ide.example.com/workspace?token=remote-token&sessionId=s1') as unknown as Location

    expect(initializeDesktopRendererConnection(bridge, location, storage, browserHistory)).toMatchObject({
      mode: 'remote',
      token: 'remote-token',
    })
    expect(storage.setItem).toHaveBeenCalledWith('ai-ide-access-token', 'remote-token')
    expect(browserHistory.replaceState).toHaveBeenCalledWith(null, '', '/workspace?sessionId=s1')
  })

  test('leaves normal browser startup unchanged', () => {
    const storage = { setItem: vi.fn() } as unknown as Storage
    const browserHistory = { state: null, replaceState: vi.fn() } as unknown as History
    const location = new URL('https://ide.example.com/workspace') as unknown as Location

    expect(initializeDesktopRendererConnection(null, location, storage, browserHistory)).toBeNull()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(browserHistory.replaceState).not.toHaveBeenCalled()
  })

  test('forwards desktop navigation requests to the SPA router', () => {
    let listener: ((request: { id: string; path: string }) => void) | undefined
    const unsubscribe = vi.fn()
    const acknowledgeNavigation = vi.fn()
    const bridge = {
      onNavigate: vi.fn((next: (request: { id: string; path: string }) => void) => {
        listener = next
        return unsubscribe
      }),
      acknowledgeNavigation,
    }
    const navigate = vi.fn()

    const stop = subscribeDesktopNavigation(bridge, navigate)
    listener?.({ id: 'navigation-1', path: '/p/project/workspace?sessionId=session-1' })

    expect(navigate).toHaveBeenCalledWith('/p/project/workspace?sessionId=session-1')
    expect(acknowledgeNavigation).toHaveBeenCalledWith('navigation-1')
    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
