import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createRealtimeProcess, type RealtimeProcessHandle } from '../../src/realtime/process-client.js'
import type { ServerMessage } from '../../src/types/ws-protocol.js'

let realtime: RealtimeProcessHandle | undefined
let socket: WebSocket | undefined

afterEach(async () => {
  socket?.close()
  socket = undefined
  await realtime?.close()
  realtime = undefined
})

describe('Realtime legacy RPC bridge', () => {
  it('keeps live subscriptions changed during a slow query across the process bridge', async () => {
    let release: () => void = (): void => {}
    let started: () => void = (): void => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const querying = new Promise<void>(resolve => { started = resolve })
    realtime = await createRealtimeProcess({
      host: '127.0.0.1', port: 0, authenticate: async () => ({ authMode: 'owner' }),
      dispatchLegacyRpc: async ({ message, state, emit }) => {
        if (message.requestId === 'slow') { started(); await gate }
        emit({ type: 'result', requestId: message.requestId, data: state.subscriptions })
        return state.subscriptions
      },
    })
    const probe = await open(`${realtime.endpointUrl}?token=owner`)
    probe.send({ type: 'subscribe', requestId: 'old', sessionIds: ['old'] })
    await probe.next('result', 'old')
    probe.send({ type: 'sessions.list', requestId: 'slow' })
    await querying
    probe.send({ type: 'subscribe', requestId: 'master', sessionIds: ['master'] })
    probe.send({ type: 'unsubscribe', requestId: 'remove', sessionIds: ['old'] })
    await probe.next('result', 'remove')
    release()
    await probe.next('result', 'slow')
    probe.send({ type: 'sessions.list', requestId: 'current' })
    expect(await probe.next('result', 'current')).toMatchObject({ data: ['master'] })
    await realtime.sendDelivery({ scope: 'session', sessionId: 'master', message: update('master') })
    await expect(probe.next('session:update')).resolves.toMatchObject({ sessionId: 'master' })
  })

  it('keeps control frames local and proxies domain RPC with state synchronization', async () => {
    const invoked: string[] = []
    realtime = await createRealtimeProcess({
      host: '127.0.0.1',
      port: 0,
      authenticate: async () => ({ authMode: 'owner' }),
      dispatchLegacyRpc: async ({ message, state, emit }) => {
        invoked.push(message.type)
        if (message.type === 'sessions.create') {
          emit({ type: 'result', requestId: message.requestId, data: { id: 'session-created' } })
          return [...state.subscriptions, 'session-created']
        }
        emit({ type: 'result', requestId: message.requestId, data: [{ id: 'session-a' }] })
        return state.subscriptions
      },
    })
    const probe = await open(`${realtime.endpointUrl}?token=owner`)

    probe.send({ type: 'subscribe', requestId: 'sub', sessionIds: ['session-a'] })
    await probe.next('result', 'sub')
    probe.send({ type: 'ping', timestamp: 1 })
    await probe.next('pong')
    expect(invoked).toEqual([])

    probe.send({ type: 'sessions.list', requestId: 'list' })
    expect(await probe.next('result', 'list')).toMatchObject({ data: [{ id: 'session-a' }] })
    probe.send({ type: 'sessions.create', requestId: 'create', agentId: 'agent-a' })
    await probe.next('result', 'create')

    await realtime.sendDelivery({
      scope: 'session',
      sessionId: 'session-created',
      message: update('session-created'),
    })
    await probe.next('session:update')
    expect(invoked).toEqual(['sessions.list', 'sessions.create'])
  })

  it('rejects domain RPC when the compatibility bridge is disabled', async () => {
    let invoked = false
    realtime = await createRealtimeProcess({
      host: '127.0.0.1',
      port: 0,
      legacyRpcEnabled: false,
      authenticate: async () => ({ authMode: 'owner' }),
      dispatchLegacyRpc: async ({ state }) => {
        invoked = true
        return state.subscriptions
      },
    })
    const probe = await open(`${realtime.endpointUrl}?token=owner`)

    probe.send({ type: 'sessions.list', requestId: 'list' })

    await expect(probe.next('error', 'list')).resolves.toMatchObject({
      message: expect.stringContaining('HTTP'),
    })
    expect(invoked).toBe(false)
  })
})

class Probe {
  private readonly messages: ServerMessage[] = []

  constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => this.messages.push(JSON.parse(raw.toString()) as ServerMessage))
  }

  send(message: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(message))
  }

  async next(type: ServerMessage['type'], requestId?: string): Promise<ServerMessage> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const index = this.messages.findIndex((message) => (
        message.type === type && (requestId === undefined || ('requestId' in message && message.requestId === requestId))
      ))
      if (index >= 0) return this.messages.splice(index, 1)[0]
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error(`Timed out waiting for ${type}`)
  }
}

async function open(url: string): Promise<Probe> {
  socket = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    socket?.once('open', resolve)
    socket?.once('error', reject)
  })
  return new Probe(socket)
}

function update(sessionId: string): Extract<ServerMessage, { type: 'session:update' }> {
  return {
    type: 'session:update',
    sessionId,
    agentId: 'agent-a',
    data: { messageId: 'message-a', role: 'agent', contentDelta: 'hello' },
  }
}
