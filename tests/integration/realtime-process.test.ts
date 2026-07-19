import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import {
  createRealtimeProcess,
  type RealtimeProcessHandle,
} from '../../src/realtime/process-client.js'
import type { ServerMessage } from '../../src/types/ws-protocol.js'

let realtime: RealtimeProcessHandle | undefined
const sockets: WebSocket[] = []

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close()
  await realtime?.close()
  realtime = undefined
})

describe('Realtime process', () => {
  it('owns authenticated sockets and delivers scoped/global events over framed IPC', async () => {
    realtime = await createRealtimeProcess({
      host: '127.0.0.1',
      port: 0,
      authenticate: async (request) => {
        if (request.token === 'owner-token') return { authMode: 'owner' }
        if (request.shareToken === 'share-a') {
          return { authMode: 'guest', sessionId: 'session-a', toolCallVisibility: 'hide' }
        }
        return undefined
      },
      dispatchLegacyRpc: async ({ state }) => state.subscriptions,
    })

    const owner = await connect(`${realtime.endpointUrl}?token=owner-token`)
    const guest = await connect(`${realtime.endpointUrl}?shareToken=share-a`)
    const rejected = await connect(`${realtime.endpointUrl}?token=wrong`, false)
    sockets.push(owner.socket, guest.socket, rejected.socket)

    owner.send({ type: 'subscribe', requestId: 'owner-sub', sessionIds: ['session-a'] })
    guest.send({ type: 'subscribe', requestId: 'guest-sub', sessionIds: ['session-a'] })
    await owner.next('result', 'owner-sub')
    await guest.next('result', 'guest-sub')
    await rejected.closed(1008)

    await realtime.sendDelivery({ scope: 'session', sessionId: 'session-a', message: updateWithTool() })
    await realtime.sendDelivery({
      scope: 'all',
      message: { type: 'task:update', taskId: 'task-a', data: { status: 'running' } },
    })

    expect(await owner.next('session:update')).toMatchObject({
      data: { toolCall: { id: 'tool-a' } },
    })
    expect(await owner.next('task:update')).toMatchObject({ taskId: 'task-a' })
    const guestUpdate = await guest.next('session:update')
    expect(guestUpdate).toMatchObject({ data: { contentDelta: 'hello' } })
    expect((guestUpdate as Extract<ServerMessage, { type: 'session:update' }>).data)
      .not.toHaveProperty('toolCall')
    await expect(guest.none('task:update', 50)).resolves.toBe(true)
  })

  it('restarts after an unexpected child exit and accepts a new connection', async () => {
    realtime = await createRealtimeProcess({
      host: '127.0.0.1',
      port: 0,
      restartDelayMs: 10,
      authenticate: async (request) => request.token === 'owner-token' ? { authMode: 'owner' } : undefined,
      dispatchLegacyRpc: async ({ state }) => state.subscriptions,
    })
    const generation = realtime.generation

    await realtime.terminateForTest()
    await realtime.waitForRestart(generation, 5_000)

    expect(realtime.generation).toBeGreaterThan(generation)
    const owner = await connect(`${realtime.endpointUrl}?token=owner-token`)
    sockets.push(owner.socket)
    owner.send({ type: 'ping', timestamp: 123 })
    await expect(owner.next('pong')).resolves.toMatchObject({ timestamp: 123 })
  })
})

class SocketProbe {
  private readonly received: ServerMessage[] = []
  private readonly waiters = new Set<() => void>()

  constructor(readonly socket: WebSocket) {
    socket.on('message', (raw) => {
      this.received.push(JSON.parse(raw.toString()) as ServerMessage)
      for (const wake of this.waiters) wake()
      this.waiters.clear()
    })
  }

  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(message))
  }

  async next(type: ServerMessage['type'], requestId?: string): Promise<ServerMessage> {
    const deadline = Date.now() + 3_000
    while (Date.now() < deadline) {
      const index = this.received.findIndex((message) => (
        message.type === type && (requestId === undefined || ('requestId' in message && message.requestId === requestId))
      ))
      if (index >= 0) return this.received.splice(index, 1)[0]
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.waiters.delete(wake)
          resolve()
        }, 50)
        const wake = (): void => {
          clearTimeout(timer)
          resolve()
        }
        this.waiters.add(wake)
      })
    }
    throw new Error(`Timed out waiting for ${type}`)
  }

  async none(type: ServerMessage['type'], waitMs: number): Promise<boolean> {
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    return !this.received.some((message) => message.type === type)
  }

  closed(code: number): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for close')), 3_000)
      this.socket.once('close', (actual) => {
        clearTimeout(timer)
        if (actual === code) resolve()
        else reject(new Error(`Expected close ${code}, got ${actual}`))
      })
    })
  }
}

async function connect(url: string, expectOpen = true): Promise<SocketProbe> {
  const socket = new WebSocket(url)
  const probe = new SocketProbe(socket)
  if (expectOpen) {
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
  }
  return probe
}

function updateWithTool(): Extract<ServerMessage, { type: 'session:update' }> {
  return {
    type: 'session:update',
    sessionId: 'session-a',
    agentId: 'agent-a',
    data: {
      messageId: 'message-a',
      role: 'agent',
      contentDelta: 'hello',
      toolCall: { id: 'tool-a', title: 'Secret tool' },
    },
  }
}
