import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { deviceStore } from '../../src/store/devices.js'
import { hashDeviceSecret } from '../../src/devices/auth.js'
import { DeviceConnections } from '../../src/devices/connections.js'

let directory: string
let server: Server
let connections: DeviceConnections
let url: string
let deviceId: string
const token = 'a'.repeat(43)
const handlers = { connected: vi.fn(), disconnected: vi.fn(), message: vi.fn() }
const sockets: WebSocket[] = []

beforeEach(async () => {
  vi.clearAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'device-connections-'))
  initDatabase(join(directory, 'test.sqlite'))
  deviceId = deviceStore.create({ name: 'PC', shells: ['powershell'], publicKey: 'unused', tokenHash: hashDeviceSecret(token) }).id
  connections = new DeviceConnections(handlers)
  server = createServer()
  server.on('upgrade', (request, socket, head) => connections.handleUpgrade(request, socket, head))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  url = `ws://127.0.0.1:${address.port}/node-ws`
})

afterEach(async () => {
  const closed = sockets.splice(0).map(async (socket): Promise<void> => {
    if (socket.readyState === WebSocket.CLOSED) return
    const pending = once(socket, 'close')
    socket.terminate()
    await pending
  })
  connections.close()
  await Promise.all(closed)
  await new Promise<void>((resolve) => server.close(() => resolve()))
  closeDatabase()
  rmSync(directory, { recursive: true, force: true })
})

async function connect(): Promise<{ socket: WebSocket; generation: string }> {
  const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } })
  sockets.push(socket)
  const [raw] = await once(socket, 'message')
  const welcome = JSON.parse(String(raw)) as { generation: string }
  return { socket, generation: welcome.generation }
}

describe('authenticated node connection generations', () => {
  it('does not unregister the replacement when an older connection closes', async () => {
    const first = await connect()
    const oldClosed = once(first.socket, 'close')
    const second = await connect()
    await oldClosed
    expect(second.generation).not.toBe(first.generation)
    expect(connections.online(deviceId)).toBe(true)
    expect(handlers.disconnected).not.toHaveBeenCalled()
    const received = once(second.socket, 'message')
    connections.send(deviceId, { type: 'job.query', jobId: 'test' })
    expect(JSON.parse(String((await received)[0]))).toMatchObject({ generation: second.generation, jobId: 'test' })
  })

  it('rejects a stale generation even on the authenticated replacement socket', async () => {
    const peer = await connect()
    const closed = once(peer.socket, 'close')
    peer.socket.send(JSON.stringify({ version: 1, generation: 'stale', type: 'job.state', jobId: 'test', state: 'succeeded' }))
    expect((await closed)[0]).toBe(1008)
    expect(handlers.message).not.toHaveBeenCalled()
    expect(connections.online(deviceId)).toBe(false)
  })
})
