import { beforeEach, describe, expect, test, vi } from 'vitest'

const wsMock = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn((event: string, handler: (message: Record<string, unknown>) => void) => {
    if (event === 'connection') wsMock.connectionHandler = handler
    return () => {
      if (event === 'connection' && wsMock.connectionHandler === handler) wsMock.connectionHandler = null
    }
  }),
  connectionHandler: null as ((message: Record<string, unknown>) => void) | null,
}))

vi.mock('@desktop/services/ws-client', () => ({
  wsClient: wsMock,
}))

const { useConnectionStore } = await import('../../mobile/src/stores/connection.store.ts')

const storage = new Map<string, string>()

const localStorageMock = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { storage.set(key, value) }),
  removeItem: vi.fn((key: string) => { storage.delete(key) }),
  clear: vi.fn(() => { storage.clear() }),
}

function resetStore(): void {
  vi.stubGlobal('localStorage', localStorageMock)
  storage.clear()
  localStorageMock.getItem.mockClear()
  localStorageMock.setItem.mockClear()
  localStorageMock.removeItem.mockClear()
  localStorageMock.clear.mockClear()
  useConnectionStore.setState({
    serverUrl: '',
    token: '',
    connected: false,
    status: 'idle',
    lastError: '',
  } as unknown as Parameters<typeof useConnectionStore.setState>[0])
  wsMock.connect.mockReset()
  wsMock.disconnect.mockReset()
  wsMock.on.mockClear()
}

describe('mobile connection store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
  })

  test('initializes a saved server as connecting and starts websocket connection', () => {
    localStorage.setItem('ai-ide-mobile-server', JSON.stringify({
      serverUrl: 'http://127.0.0.1:18800',
      token: 'token-a',
    }))

    useConnectionStore.getState().init()

    expect(useConnectionStore.getState()).toMatchObject({
      serverUrl: 'http://127.0.0.1:18800',
      token: 'token-a',
      connected: false,
      status: 'connecting',
      lastError: '',
    })
    expect(wsMock.connect).toHaveBeenCalledWith('ws://127.0.0.1:18800?token=token-a')
  })

  test('connection event marks the store as connected', () => {
    useConnectionStore.getState().setServer('http://127.0.0.1:18800')
    wsMock.connectionHandler?.({ connected: true })

    expect(useConnectionStore.getState()).toMatchObject({
      connected: true,
      status: 'connected',
      lastError: '',
    })
  })

  test('connection timeout marks the saved server as failed', () => {
    useConnectionStore.getState().setServer('http://127.0.0.1:18800')

    vi.advanceTimersByTime(5_000)

    expect(useConnectionStore.getState()).toMatchObject({
      serverUrl: 'http://127.0.0.1:18800',
      connected: false,
      status: 'failed',
      lastError: '连接失败，请检查地址或 Token',
    })
  })

  test('connection close while connecting fails immediately', () => {
    useConnectionStore.getState().setServer('http://127.0.0.1:18800')
    wsMock.connectionHandler?.({ connected: false, message: 'WebSocket connection failed' })

    expect(useConnectionStore.getState()).toMatchObject({
      connected: false,
      status: 'failed',
      lastError: 'WebSocket connection failed',
    })
  })

  test('synchronous websocket connection errors fail immediately', () => {
    wsMock.connect.mockImplementationOnce(() => {
      throw new Error('SecurityError')
    })

    expect(() => useConnectionStore.getState().setServer('http://192.168.115.42:18900')).not.toThrow()

    expect(useConnectionStore.getState()).toMatchObject({
      connected: false,
      status: 'failed',
      lastError: 'SecurityError',
    })
  })
})
