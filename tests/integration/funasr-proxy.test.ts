import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { startGateway } from '../../src/gateway/server.js'

type GatewayHandle = Awaited<ReturnType<typeof startGateway>>

let gateway: GatewayHandle | undefined
let upstreamServer: Server | undefined
let upstreamWss: WebSocketServer | undefined

afterEach(async () => {
  if (gateway) {
    for (const client of gateway.wss?.clients ?? []) client.close()
    await gateway.funAsrProxy.close()
    gateway.wss?.close()
    await new Promise<void>((resolve) => gateway?.server.close(() => resolve()))
    gateway = undefined
  }
  if (upstreamWss) {
    for (const client of upstreamWss.clients) client.close()
    await new Promise<void>((resolve) => upstreamWss?.close(() => resolve()))
    upstreamWss = undefined
  }
  if (upstreamServer) {
    await new Promise<void>((resolve) => upstreamServer?.close(() => resolve()))
    upstreamServer = undefined
  }
})

describe('FunASR Gateway WebSocket proxy', () => {
  it('rejects unauthorized clients before opening an upstream connection', async () => {
    const upstream = await startFunAsrUpstream()
    gateway = await startGateway(baseConfig({ localToken: 'voice-secret', funAsrWsUrl: upstream.url }))

    await expect(connect(`${gatewayUrl()}/api/v1/voice/asr`)).rejects.toThrow('401')
    expect(upstream.connections()).toBe(0)
  })

  it('returns service unavailable when FunASR is not configured', async () => {
    gateway = await startGateway(baseConfig({ localToken: 'voice-secret' }))

    await expect(connect(`${gatewayUrl()}/api/v1/voice/asr?token=voice-secret`)).rejects.toThrow('503')
  })

  it('forwards buffered PCM and final transcription frames in order', async () => {
    const upstream = await startFunAsrUpstream()
    gateway = await startGateway(baseConfig({ localToken: 'voice-secret', funAsrWsUrl: upstream.url }))
    const client = await connect(`${gatewayUrl()}/api/v1/voice/asr?token=voice-secret`)
    const pcm = Buffer.from([1, 2, 3, 4])

    client.send(JSON.stringify({ mode: '2pass', is_speaking: true }))
    client.send(pcm)
    const ready = await nextJson(client)
    const final = await nextJson(client)

    expect(ready).toEqual({ type: 'ready' })
    expect(final).toMatchObject({ is_final: true, text: 'FunASR works' })
    expect(upstream.received()).toEqual([
      { binary: false, value: JSON.stringify({ mode: '2pass', is_speaking: true }) },
      { binary: true, value: pcm.toString('hex') },
    ])
    client.close()
  })
})

function baseConfig(overrides: Record<string, unknown>) {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir: process.cwd(),
    runtime: 'web' as const,
    ...overrides,
  }
}

async function startFunAsrUpstream(): Promise<{
  url: string
  connections(): number
  received(): Array<{ binary: boolean; value: string }>
}> {
  const received: Array<{ binary: boolean; value: string }> = []
  let connections = 0
  upstreamServer = createServer()
  upstreamWss = new WebSocketServer({ server: upstreamServer })
  upstreamWss.on('connection', (socket) => {
    connections += 1
    let messages = 0
    socket.on('message', (data, binary) => {
      received.push({ binary, value: binary ? data.toString('hex') : data.toString() })
      messages += 1
      if (messages === 2) socket.send(JSON.stringify({ is_final: true, text: 'FunASR works' }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    upstreamServer?.once('error', reject)
    upstreamServer?.listen(0, '127.0.0.1', resolve)
  })
  const address = upstreamServer.address()
  if (!address || typeof address === 'string') throw new Error('FunASR test server did not start')
  return {
    url: `ws://127.0.0.1:${address.port}`,
    connections: () => connections,
    received: () => received,
  }
}

function gatewayUrl(): string {
  const address = gateway?.server.address()
  if (!address || typeof address === 'string') throw new Error('Gateway did not start')
  return `ws://127.0.0.1:${address.port}`
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.once('open', () => resolve(socket))
    socket.once('unexpected-response', (_, response) => reject(new Error(String(response.statusCode))))
    socket.once('error', reject)
  })
}

function nextJson(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for ASR message')), 3_000)
    socket.once('message', (data) => {
      clearTimeout(timeout)
      resolve(JSON.parse(data.toString()) as Record<string, unknown>)
    })
  })
}
