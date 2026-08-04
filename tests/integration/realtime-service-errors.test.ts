import { afterEach, describe, expect, test, vi } from 'vitest'
import WebSocket from 'ws'
import { startRealtimeService, type RealtimeServiceHandle } from '../../src/realtime/service.js'
import type { RealtimeIpcPayload } from '../../src/realtime/protocol.js'

let service: RealtimeServiceHandle | undefined
let socket: WebSocket | undefined

afterEach(async () => {
  socket?.close()
  socket = undefined
  await service?.close()
  service = undefined
})

describe('Realtime service asynchronous failures', () => {
  test('closes only the pending connection when authentication IPC dispatch fails', async () => {
    service = await startService(async () => { throw new Error('parent IPC unavailable') })
    socket = new WebSocket(`ws://127.0.0.1:${service.port}`)

    await expect(socketClosed(socket)).resolves.toMatchObject({ code: 1011 })
  })

  test('returns an error frame when legacy RPC dispatch fails', async () => {
    let authRequest: Extract<RealtimeIpcPayload, { type: 'auth.request' }> | undefined
    const sendIpc = vi.fn(async (payload: RealtimeIpcPayload) => {
      if (payload.type === 'auth.request') {
        authRequest = payload
        return
      }
      if (payload.type === 'rpc.request') throw new Error('parent IPC unavailable')
    })
    service = await startService(sendIpc)
    socket = new WebSocket(`ws://127.0.0.1:${service.port}`)
    await socketOpened(socket)
    await vi.waitFor(() => expect(authRequest).toBeDefined())
    await service.handleIpc({
      type: 'auth.result',
      connectionId: authRequest!.connectionId,
      claims: { authMode: 'owner' },
    })

    const response = nextMessage(socket)
    socket.send(JSON.stringify({ type: 'tasks.list', requestId: 'request-1' }))

    await expect(response).resolves.toMatchObject({
      type: 'error',
      requestId: 'request-1',
      message: '服务暂时不可用，请重试',
    })
  })
})

function startService(sendIpc: (payload: RealtimeIpcPayload) => Promise<void>): Promise<RealtimeServiceHandle> {
  return startRealtimeService({
    host: '127.0.0.1',
    port: 0,
    maxQueueMessages: 20,
    maxQueueBytes: 64 * 1024,
    maxBufferedBytes: 64 * 1024,
    flushIntervalMs: 1,
    legacyRpcEnabled: true,
    sendIpc,
  })
}

function socketOpened(client: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once('open', resolve)
    client.once('error', reject)
  })
}

function socketClosed(client: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    client.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))
    client.once('error', reject)
  })
}

function nextMessage(client: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for Realtime message')), 2_000)
    client.once('message', (raw) => {
      clearTimeout(timer)
      resolve(JSON.parse(raw.toString()) as Record<string, unknown>)
    })
  })
}
