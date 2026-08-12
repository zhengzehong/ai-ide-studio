import { beforeEach, describe, expect, test, vi } from 'vitest'

const voiceMock = vi.hoisted(() => ({
  getStatus: vi.fn(async () => ({ state: 'listening' as const })),
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  addListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => voiceMock,
}))

vi.mock('@desktop/services/ws-client', () => ({ wsClient: { request: vi.fn() } }))
vi.mock('../../mobile/src/stores/connection.store.ts', () => ({
  resolveMobileRealtimeUrl: vi.fn(async () => 'ws://localhost:18800'),
  useConnectionStore: { getState: () => ({ connected: true, serverUrl: 'http://localhost:18800', token: 'token' }) },
}))

const { useVoiceStore, voiceStateLabel } = await import('../../mobile/src/stores/voice.store.ts')

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
  clear: () => { storage.clear() },
})

describe('mobile realtime voice store', () => {
  beforeEach(() => {
    storage.clear()
    useVoiceStore.setState({
      enabled: false,
      state: 'disabled',
      message: '',
      projectId: null,
      agentId: null,
      sessionId: null,
      hydrated: false,
    })
    voiceMock.addListener.mockClear()
  })

  test('preserves the enabled flag when native status only changes state', () => {
    useVoiceStore.setState({ enabled: true })
    const cleanup = useVoiceStore.getState().setupListeners()
    expect(voiceStateLabel('listening')).toBe('监听中')
    cleanup()
    expect(useVoiceStore.getState().enabled).toBe(true)
  })

  test('cleans up a listener that resolves after unmount', async () => {
    let resolveListener: ((value: { remove: () => Promise<void> }) => void) | undefined
    const remove = vi.fn(async () => undefined)
    voiceMock.addListener.mockImplementationOnce(() => new Promise((resolve) => { resolveListener = resolve }))
    const cleanup = useVoiceStore.getState().setupListeners()
    cleanup()
    resolveListener?.({ remove })
    await Promise.resolve()
    expect(remove).toHaveBeenCalledTimes(1)
  })
})
