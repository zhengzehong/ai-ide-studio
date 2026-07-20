import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  getStoredAccessToken,
  isUnauthorizedClose,
  resolveWsUrl,
  setConnectionClientForTest,
  storeAccessToken,
  useConnectionStore,
} from '../../ui/src/stores/connection.store'

describe('PC connection auth', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
    vi.stubGlobal('window', { location: new URL('http://localhost:18900/workspace') })
    localStorage.clear()
    useConnectionStore.setState({ connected: false, authRequired: false, authError: null, token: '' })
    setConnectionClientForTest(null)
  })

  test('keeps websocket URL token-free when no token is available', () => {
    const location = new URL('http://localhost:18900/workspace') as unknown as Location

    expect(resolveWsUrl(location)).toBe('ws://localhost:18800')
  })

  test('uses a saved token without requiring the token in the page URL', () => {
    storeAccessToken('secret-token')
    const location = new URL('http://localhost:18900/workspace') as unknown as Location

    expect(getStoredAccessToken()).toBe('secret-token')
    expect(resolveWsUrl(location)).toBe('ws://localhost:18800?token=secret-token')
  })

  test('can override a stale token from the page URL after manual entry', () => {
    const location = new URL('http://localhost:18900/workspace?token=old-token') as unknown as Location

    expect(resolveWsUrl(location, 'new-token')).toBe('ws://localhost:18800?token=new-token')
  })

  test('marks auth as required only for unauthorized websocket closes', () => {
    expect(isUnauthorizedClose(1006, '')).toBe(false)
    expect(isUnauthorizedClose(1008, '未授权')).toBe(true)
    expect(isUnauthorizedClose(1008, '乱码reason')).toBe(true)
    expect(isUnauthorizedClose(1008, 'Unauthorized')).toBe(true)
  })

  test('stops automatic websocket reconnects after unauthorized close', () => {
    let connectionHandler: ((msg: Record<string, unknown>) => void) | undefined
    const client = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      on: vi.fn((event: string, handler: (msg: Record<string, unknown>) => void) => {
        if (event === 'connection') connectionHandler = handler
        return () => undefined
      }),
    }
    setConnectionClientForTest(client)

    useConnectionStore.getState().init()
    connectionHandler?.({ connected: false, code: 1008, reason: '未授权' })

    expect(client.disconnect).toHaveBeenCalledTimes(1)
    expect(useConnectionStore.getState().authRequired).toBe(true)
  })
})

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => { values.delete(key) },
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}
