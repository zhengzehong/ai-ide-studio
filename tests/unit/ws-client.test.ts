import { beforeEach, describe, expect, test, vi } from 'vitest'

class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []

  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
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
})
