import { beforeEach, describe, expect, test, vi } from 'vitest'

class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []

  onopen: (() => void) | null = null
  onclose: ((event?: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  readyState = 0
  send = vi.fn()
  close = vi.fn()

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
}

describe('ws client', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  test('ignores stale close events after reconnecting to a new socket', async () => {
    const { wsClient } = await import('../../ui/src/services/ws-client.ts')
    const events: Record<string, unknown>[] = []
    wsClient.on('connection', (event) => events.push(event))

    wsClient.connect('ws://first')
    const firstSocket = FakeWebSocket.instances[0]
    wsClient.connect('ws://second')

    firstSocket.onclose?.()

    expect(events).toEqual([])
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  test('does not emit connected:false on onerror (onclose is the single source of truth)', async () => {
    const { wsClient } = await import('../../ui/src/services/ws-client.ts')
    const events: Record<string, unknown>[] = []
    wsClient.on('connection', (event) => events.push(event))

    wsClient.connect('ws://fail')
    const socket = FakeWebSocket.instances[0]
    socket.onerror?.()

    expect(events).toEqual([])
    expect(wsClient.connected).toBe(false)

    socket.onclose?.({ code: 1006, reason: '' })
    expect(events).toEqual([{ connected: false, code: 1006, reason: '' }])
  })

  test('detaches old socket callbacks before close so stale onerror cannot flip state', async () => {
    const { wsClient } = await import('../../ui/src/services/ws-client.ts')
    const events: Record<string, unknown>[] = []
    wsClient.on('connection', (event) => events.push(event))

    wsClient.connect('ws://first')
    const firstSocket = FakeWebSocket.instances[0]
    wsClient.connect('ws://second')
    const secondSocket = FakeWebSocket.instances[1]

    // Stale error from the first socket — should be a no-op because callbacks
    // were detached before close.
    firstSocket.onerror?.()
    secondSocket.onopen?.()

    expect(events).toEqual([{ connected: true }])
    expect(wsClient.connected).toBe(true)
  })

  test('re-runs an async endpoint resolver before reconnecting', async () => {
    const { wsClient } = await import('../../ui/src/services/ws-client.ts')
    const resolver = vi.fn()
      .mockResolvedValueOnce('ws://first')
      .mockResolvedValueOnce('ws://second')

    wsClient.connect(resolver)
    await vi.runAllTicks()
    const first = FakeWebSocket.instances[0]
    first.onopen?.()
    first.onclose?.({ code: 1006, reason: '' })
    await vi.advanceTimersByTimeAsync(3000)

    expect(resolver).toHaveBeenCalledTimes(2)
    expect(FakeWebSocket.instances.map((socket) => socket.url)).toEqual(['ws://first', 'ws://second'])
  })
})
