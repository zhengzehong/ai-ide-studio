import { Agent, createServer, get, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { startEdgeGateway, type EdgeGatewayHandle } from '../../src/edge/gateway.js'

interface UpstreamHandle {
  httpUrl: string
  wsUrl: string
  connectionCount(): number
  broadcast(payload: string): void
  close(): Promise<void>
}

let edge: EdgeGatewayHandle | undefined
const upstreams: UpstreamHandle[] = []
const sockets: WebSocket[] = []

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close()
  await edge?.close()
  edge = undefined
  await Promise.all(upstreams.splice(0).map((upstream) => upstream.close()))
})

describe('Edge gateway', () => {
  it('proxies HTTP bodies and WebSocket upgrades through one public port', async () => {
    const api = await startUpstream('api-a')
    const realtime = await startUpstream('realtime-a')
    upstreams.push(api, realtime)
    edge = await startEdgeGateway({
      host: '127.0.0.1',
      port: 0,
      targets: { apiUrl: api.httpUrl, realtimeUrl: realtime.wsUrl },
    })

    const response = await fetch(`${edge.endpointUrl}/commands?scope=project-a`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'payload-a',
    })
    const body = await response.json() as Record<string, unknown>
    const socket = await connect(`${toWs(edge.endpointUrl)}/realtime?token=owner`)
    const voiceSocket = await connect(`${toWs(edge.endpointUrl)}/api/v1/voice/asr`)
    sockets.push(socket)
    sockets.push(voiceSocket)

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      source: 'api-a',
      method: 'POST',
      url: '/commands?scope=project-a',
      body: 'payload-a',
    })
    expect(body.host).toBe(new URL(edge.endpointUrl).host)
    await expect(probe(socket)).resolves.toEqual({
      source: 'realtime-a',
      url: '/realtime?token=owner',
    })
    await expect(probe(voiceSocket)).resolves.toEqual({
      source: 'api-a',
      url: '/api/v1/voice/asr',
    })
  })

  it('updates internal targets without changing the public endpoint', async () => {
    const first = await startUpstream('first')
    const second = await startUpstream('second')
    upstreams.push(first, second)
    edge = await startEdgeGateway({
      host: '127.0.0.1',
      port: 0,
      targets: { apiUrl: first.httpUrl, realtimeUrl: first.wsUrl },
    })
    const publicUrl = edge.endpointUrl

    edge.updateTargets({ apiUrl: second.httpUrl, realtimeUrl: second.wsUrl })
    const response = await fetch(`${edge.endpointUrl}/health`)
    const socket = await connect(`${toWs(edge.endpointUrl)}/realtime`)
    sockets.push(socket)

    await expect(response.json()).resolves.toMatchObject({ source: 'second' })
    await expect(probe(socket)).resolves.toMatchObject({ source: 'second' })
    expect(edge.endpointUrl).toBe(publicUrl)
  })

  it('preserves client keep-alive and reuses the upstream API connection', async () => {
    const upstream = await startUpstream('keep-alive')
    upstreams.push(upstream)
    edge = await startEdgeGateway({
      host: '127.0.0.1',
      port: 0,
      targets: { apiUrl: upstream.httpUrl, realtimeUrl: upstream.wsUrl },
    })
    const agent = new Agent({ keepAlive: true, maxSockets: 1 })

    try {
      const first = await getJsonWithAgent(`${edge.endpointUrl}/first`, agent)
      const second = await getJsonWithAgent(`${edge.endpointUrl}/second`, agent)

      expect(first.headers.connection).toBe('keep-alive')
      expect(second.headers.connection).toBe('keep-alive')
      expect(upstream.connectionCount()).toBe(1)
    } finally {
      agent.destroy()
    }
  })

  it('keeps serving HTTP after a WebSocket client disconnects without a close frame', async () => {
    const upstream = await startUpstream('resilient')
    upstreams.push(upstream)
    edge = await startEdgeGateway({
      host: '127.0.0.1',
      port: 0,
      targets: { apiUrl: upstream.httpUrl, realtimeUrl: upstream.wsUrl },
    })
    const socket = await connect(`${toWs(edge.endpointUrl)}/realtime`)

    const transport = (socket as WebSocket & { _socket: { pause(): void } })._socket
    transport.pause()
    for (let index = 0; index < 16; index += 1) upstream.broadcast('x'.repeat(256 * 1024))
    await new Promise((resolve) => setTimeout(resolve, 20))
    socket.terminate()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const response = await fetch(`${edge.endpointUrl}/health`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ source: 'resilient' })
  })

  it('returns explicit unavailability when supervised targets are absent', async () => {
    const upstream = await startUpstream('available')
    upstreams.push(upstream)
    edge = await startEdgeGateway({
      host: '127.0.0.1',
      port: 0,
      targets: { apiUrl: upstream.httpUrl, realtimeUrl: upstream.wsUrl },
    })

    edge.updateTargets({})
    const response = await fetch(`${edge.endpointUrl}/health`)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'service-unavailable',
      target: 'api',
    })
    await expect(connect(`${toWs(edge.endpointUrl)}/realtime`)).rejects.toThrow('503')
  })

  it('stops accepting public connections on close', async () => {
    const upstream = await startUpstream('close')
    upstreams.push(upstream)
    edge = await startEdgeGateway({
      host: '127.0.0.1',
      port: 0,
      targets: { apiUrl: upstream.httpUrl, realtimeUrl: upstream.wsUrl },
    })
    const endpointUrl = edge.endpointUrl

    await edge.close()
    edge = undefined

    await expect(fetch(`${endpointUrl}/health`)).rejects.toThrow()
  })
})

async function startUpstream(source: string): Promise<UpstreamHandle> {
  let connections = 0
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        source,
        method: request.method,
        url: request.url,
        host: request.headers.host,
        body,
      }))
    })
  })
  server.on('connection', () => { connections += 1 })
  const wss = new WebSocketServer({ server })
  wss.on('connection', (socket, request) => {
    socket.on('message', () => socket.send(JSON.stringify({ source, url: request.url })))
  })
  await listen(server)
  const port = serverPort(server)
  return {
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    connectionCount: () => connections,
    broadcast: (payload) => {
      for (const client of wss.clients) client.send(payload)
    },
    close: async () => {
      for (const client of wss.clients) client.close()
      await closeWebSocketServer(wss)
      await closeServer(server)
    },
  }
}

function getJsonWithAgent(
  url: string,
  agent: Agent,
): Promise<{ headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const request = get(url, { agent }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => { body += chunk })
      response.on('end', () => resolve({ headers: response.headers, body: JSON.parse(body) as Record<string, unknown> }))
    })
    request.once('error', reject)
  })
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
}

function serverPort(server: Server): number {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Server is not listening on TCP')
  return address.port
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

function closeWebSocketServer(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => wss.close((error) => error ? reject(error) : resolve()))
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.once('open', () => resolve(socket))
    socket.once('unexpected-response', (_, response) => reject(new Error(String(response.statusCode))))
    socket.once('error', reject)
  })
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for WebSocket message')), 3_000)
    socket.once('message', (raw) => {
      clearTimeout(timer)
      resolve(JSON.parse(raw.toString()) as Record<string, unknown>)
    })
  })
}

function probe(socket: WebSocket): Promise<Record<string, unknown>> {
  const response = nextMessage(socket)
  socket.send('probe')
  return response
}

function toWs(httpUrl: string): string {
  return httpUrl.replace(/^http/, 'ws')
}
