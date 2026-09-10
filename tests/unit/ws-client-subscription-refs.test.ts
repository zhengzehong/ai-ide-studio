import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WSClient } from '../../ui/src/services/ws-client'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  readyState = 1
  sent: Array<Record<string, unknown>> = []
  onopen: (() => void) | null = null
  onclose: ((ev: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }
  close() {
    this.readyState = 3
  }
}

function sentOf(sock: FakeWebSocket, type: string): Array<Record<string, unknown>> {
  return sock.sent.filter((msg) => msg.type === type)
}

function lastSessionIds(sock: FakeWebSocket, type: string): string[] {
  const msgs = sentOf(sock, type)
  const last = msgs.at(-1)
  return (last?.sessionIds as string[] | undefined) ?? []
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function connectedClient(): { client: WSClient; sock: FakeWebSocket } {
  const client = new WSClient()
  client.connect('ws://test')
  const sock = FakeWebSocket.instances.at(-1)!
  sock.onopen?.()
  client.setEventListenersReady(true)
  sock.sent.length = 0
  return { client, sock }
}

describe('ws-client subscription refcount', () => {
  test('shared session: one subscriber unsubscribing keeps the subscription alive', () => {
    const { client, sock } = connectedClient()
    client.subscribe(['a'])
    client.subscribe(['a'])
    expect(lastSessionIds(sock, 'subscribe')).toEqual(['a'])
    expect(sentOf(sock, 'subscribe')).toHaveLength(1)

    client.unsubscribe(['a'])
    expect(sentOf(sock, 'unsubscribe')).toHaveLength(0)

    client.unsubscribe(['a'])
    expect(lastSessionIds(sock, 'unsubscribe')).toEqual(['a'])
  })

  test('unsubscribe only drops sessions whose refcount reaches zero', () => {
    const { client, sock } = connectedClient()
    client.subscribe(['a', 'b'])
    client.subscribe(['b', 'c'])
    expect(sentOf(sock, 'subscribe').map((msg) => msg.sessionIds)).toEqual([['a', 'b'], ['c']])

    client.unsubscribe(['a'])
    expect(lastSessionIds(sock, 'unsubscribe')).toEqual(['a'])

    client.unsubscribe(['b', 'c'])
    expect(lastSessionIds(sock, 'unsubscribe')).toEqual(['c'])
  })

  test('subscriptions made before listeners ready are restored exactly once', () => {
    const client = new WSClient()
    client.connect('ws://test')
    const sock = FakeWebSocket.instances.at(-1)!
    sock.onopen?.()

    client.subscribe(['x'])
    client.subscribe(['x'])
    client.setEventListenersReady(true)

    expect(sentOf(sock, 'subscribe')).toHaveLength(1)
    expect(lastSessionIds(sock, 'subscribe')).toEqual(['x'])
  })

  test('reconnect restores the full effective subscription set', () => {
    vi.useFakeTimers()
    const { client, sock } = connectedClient()
    client.subscribe(['a', 'b'])

    sock.onclose?.({ code: 1006, reason: '' })
    vi.advanceTimersByTime(3000)
    const nextSock = FakeWebSocket.instances.at(-1)!
    expect(nextSock).not.toBe(sock)
    nextSock.onopen?.()

    expect(lastSessionIds(nextSock, 'subscribe')).toEqual(['a', 'b'])
  })

  test('unsubscribing a session that was only defended by sendPrompt still unsubscribes', () => {
    const { client, sock } = connectedClient()
    client.sendPrompt('s1', 'hello')
    client.unsubscribe(['s1'])
    expect(lastSessionIds(sock, 'unsubscribe')).toEqual(['s1'])
  })
})
