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
  test('rejects outstanding queries immediately on disconnect instead of timing out later', async () => {
    const { wsClient } = await import('../../ui/src/services/ws-client.ts')
    wsClient.connect('ws://realtime')
    const socket = FakeWebSocket.instances[0]
    socket.readyState = FakeWebSocket.OPEN
    socket.onopen?.()
    const pending = wsClient.request({ type: 'sessions.recovery', sessionId: 's' })
    const assertion = expect(pending).rejects.toThrow('连接已断开')
    socket.onclose?.({ code: 1013, reason: 'backpressure' })
    await assertion
    wsClient.disconnect()
  })

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

  test('restores subscriptions before sending saved cursors on reconnect', async () => {
    const { wsClient } = await import('../../ui/src/services/ws-client.ts')
    wsClient.setEventListenersReady(true)
    wsClient.connect('ws://realtime')
    const first = FakeWebSocket.instances[0]
    first.readyState = FakeWebSocket.OPEN
    first.onopen?.()
    wsClient.subscribe(['session-a'])
    first.onmessage?.({
      data: JSON.stringify({
        type: 'session:update',
        sessionId: 'session-a',
        streamGeneration: 'generation-a',
        sequence: 3,
      }),
    })

    first.onclose?.({ code: 1006, reason: '' })
    await vi.advanceTimersByTimeAsync(3000)
    const second = FakeWebSocket.instances[1]
    second.readyState = FakeWebSocket.OPEN
    second.onopen?.()

    expect(second.send.mock.calls.map(([payload]) => JSON.parse(String(payload)))).toEqual([
      { type: 'subscribe', sessionIds: ['session-a'] },
      {
        type: 'resume',
        cursors: { 'session-a': { streamGeneration: 'generation-a', sequence: 3 } },
      },
    ])
  })

  test('acknowledges snapshot resync without reusing the stale session cursor', async () => {
    const { wsClient } = await import('../../ui/src/services/ws-client.ts')
    wsClient.setEventListenersReady(true)
    wsClient.connect('ws://realtime')
    const socket = FakeWebSocket.instances[0]
    socket.readyState = FakeWebSocket.OPEN
    socket.onopen?.()
    wsClient.subscribe(['session-a'])
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'session:update',
        sessionId: 'session-a',
        streamGeneration: 'generation-a',
        sequence: 3,
      }),
    })
    socket.send.mockClear()

    wsClient.acknowledgeResync('session-a')

    expect(JSON.parse(String(socket.send.mock.calls[0]?.[0]))).toEqual({
      type: 'resume',
      cursors: {},
    })
  })

  test('waits for application listeners before restoring subscriptions and cursors', async () => {
    const { wsClient } = await import('../../ui/src/services/ws-client.ts')
    wsClient.setEventListenersReady(true)
    wsClient.connect('ws://realtime')
    const first = FakeWebSocket.instances[0]
    first.readyState = FakeWebSocket.OPEN
    first.onopen?.()
    wsClient.subscribe(['session-a'])
    first.onmessage?.({
      data: JSON.stringify({
        type: 'session:update',
        sessionId: 'session-a',
        streamGeneration: 'generation-a',
        sequence: 3,
      }),
    })

    wsClient.setEventListenersReady(false)
    first.onclose?.({ code: 1006, reason: '' })
    await vi.advanceTimersByTimeAsync(3000)
    const second = FakeWebSocket.instances[1]
    second.readyState = FakeWebSocket.OPEN
    second.onopen?.()

    expect(second.send).not.toHaveBeenCalled()

    const updates: Record<string, unknown>[] = []
    wsClient.on('session:update', (message) => updates.push(message))
    wsClient.setEventListenersReady(true)

    expect(second.send.mock.calls.map(([payload]) => JSON.parse(String(payload)))).toEqual([
      { type: 'subscribe', sessionIds: ['session-a'] },
      {
        type: 'resume',
        cursors: { 'session-a': { streamGeneration: 'generation-a', sequence: 3 } },
      },
    ])

    second.onmessage?.({
      data: JSON.stringify({
        type: 'session:update',
        sessionId: 'session-a',
        streamGeneration: 'generation-a',
        sequence: 4,
      }),
    })
    expect(updates).toHaveLength(1)
  })

  test('restores subscriptions registered before listeners are ready on first connect', async () => {
    const { wsClient } = await import('../../ui/src/services/ws-client.ts')
    wsClient.subscribe(['session-a'])
    wsClient.connect('ws://realtime')
    const socket = FakeWebSocket.instances[0]
    socket.readyState = FakeWebSocket.OPEN
    socket.onopen?.()

    expect(socket.send).not.toHaveBeenCalled()

    wsClient.setEventListenersReady(true)

    expect(socket.send.mock.calls.map(([payload]) => JSON.parse(String(payload)))).toEqual([
      { type: 'subscribe', sessionIds: ['session-a'] },
    ])
  })

  test('sends a heartbeat ping every 15 seconds while connected', async () => {
    const { WS_HEARTBEAT_INTERVAL_MS, wsClient } = await import('../../ui/src/services/ws-client.ts')
    wsClient.connect('ws://realtime')
    const socket = FakeWebSocket.instances[0]
    socket.readyState = FakeWebSocket.OPEN
    socket.onopen?.()

    await vi.advanceTimersByTimeAsync(WS_HEARTBEAT_INTERVAL_MS)

    expect(JSON.parse(String(socket.send.mock.calls[0]?.[0]))).toMatchObject({
      type: 'ping',
      timestamp: expect.any(Number),
    })
  })

  test('reconnects after 30 seconds without any inbound frame', async () => {
    const {
      WS_HEARTBEAT_TIMEOUT_MS,
      wsClient,
    } = await import('../../ui/src/services/ws-client.ts')
    const events: Record<string, unknown>[] = []
    wsClient.on('connection', (event) => events.push(event))
    wsClient.connect('ws://realtime')
    const socket = FakeWebSocket.instances[0]
    socket.readyState = FakeWebSocket.OPEN
    socket.onopen?.()

    await vi.advanceTimersByTimeAsync(WS_HEARTBEAT_TIMEOUT_MS)

    expect(socket.close).toHaveBeenCalledTimes(1)
    expect(wsClient.connected).toBe(false)
    expect(events.at(-1)).toMatchObject({ connected: false, reason: 'heartbeat-timeout' })

    await vi.advanceTimersByTimeAsync(3000)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  test('treats any inbound frame as heartbeat progress', async () => {
    const {
      WS_HEARTBEAT_INTERVAL_MS,
      WS_HEARTBEAT_TIMEOUT_MS,
      wsClient,
    } = await import('../../ui/src/services/ws-client.ts')
    wsClient.connect('ws://realtime')
    const socket = FakeWebSocket.instances[0]
    socket.readyState = FakeWebSocket.OPEN
    socket.onopen?.()

    await vi.advanceTimersByTimeAsync(WS_HEARTBEAT_TIMEOUT_MS - 1)
    socket.onmessage?.({ data: JSON.stringify({ type: 'pong', timestamp: Date.now() }) })
    await vi.advanceTimersByTimeAsync(WS_HEARTBEAT_INTERVAL_MS + 1)

    expect(socket.close).not.toHaveBeenCalled()
    expect(wsClient.connected).toBe(true)
  })

  test('cleans up heartbeat timers on an intentional disconnect', async () => {
    const { WS_HEARTBEAT_INTERVAL_MS, wsClient } = await import('../../ui/src/services/ws-client.ts')
    wsClient.connect('ws://realtime')
    const socket = FakeWebSocket.instances[0]
    socket.readyState = FakeWebSocket.OPEN
    socket.onopen?.()
    wsClient.disconnect()
    socket.send.mockClear()

    await vi.advanceTimersByTimeAsync(WS_HEARTBEAT_INTERVAL_MS * 4)

    expect(socket.send).not.toHaveBeenCalled()
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})
