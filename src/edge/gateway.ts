import { Agent, createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { createProxyServer } from 'http-proxy-3'
import { createEventLoopMonitor, eventLoopMonitorOptions } from '../shared/event-loop-monitor.js'
import { createChildLogger } from '../shared/logger.js'

const log = createChildLogger('edge-gateway')

export interface EdgeTargets {
  apiUrl?: string
  realtimeUrl?: string
}

export interface EdgeGatewayHandle {
  readonly port: number
  readonly endpointUrl: string
  updateTargets(targets: EdgeTargets): void
  close(): Promise<void>
}

export interface StartEdgeGatewayOptions {
  host: string
  port: number
  targets: EdgeTargets
}

export async function startEdgeGateway(options: StartEdgeGatewayOptions): Promise<EdgeGatewayHandle> {
  let targets = normalizeTargets(options.targets)
  let activeHttpRequests = 0
  const sockets = new Set<Socket>()
  const upgradedSockets = new Set<Duplex>()
  const apiAgent = new Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16 })
  const proxy = createProxyServer({
    changeOrigin: false,
    ignorePath: false,
    prependPath: false,
    ws: true,
    xfwd: true,
  })
  proxy.on('error', (error, request, response) => {
    const target = isWebSocketRequest(request) ? 'realtime' : 'api'
    logProxyError(target, request, error)
    if (isServerResponse(response)) {
      if (response.headersSent) response.destroy(error)
      else sendJson(response, 502, { error: 'bad-gateway', target })
      return
    }
    if (!response.destroyed) response.destroy(error)
  })
  proxy.on('econnreset', (error, request) => {
    log.debug({
      err: error,
      target: isWebSocketRequest(request) ? 'realtime' : 'api',
      method: request.method,
      path: safePath(request.url),
    }, 'Edge proxy client disconnected')
  })

  const server = createServer((request, response) => {
    const target = targets.apiUrl
    if (!target) {
      sendJson(response, 503, { error: 'service-unavailable', target: 'api' })
      return
    }
    activeHttpRequests += 1
    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      activeHttpRequests = Math.max(0, activeHttpRequests - 1)
    }
    response.once('finish', finish)
    response.once('close', finish)
    proxy.web(request, response, { target, agent: apiAgent }, (error) => {
      logProxyError('api', request, error)
      if (response.headersSent) response.destroy(error)
      else sendJson(response, 502, { error: 'bad-gateway', target: 'api' })
    })
  })

  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => {
      sockets.delete(socket)
      upgradedSockets.delete(socket)
    })
  })
  server.on('upgrade', (request, socket, head) => {
    const target = targets.realtimeUrl
    if (!target) {
      rejectUpgrade(socket, 503, 'Service Unavailable')
      return
    }
    upgradedSockets.add(socket)
    proxy.ws(request, socket, head, { target }, (error) => {
      logProxyError('realtime', request, error)
      if (!socket.destroyed) rejectUpgrade(socket, 502, 'Bad Gateway')
    })
  })

  await listen(server, options.host, options.port)
  const port = serverPort(server)
  const endpointUrl = `http://${formatPublicHost(options.host)}:${port}`
  const eventLoopMonitor = createEventLoopMonitor(eventLoopMonitorOptions('edge', () => ({
    activeHttpRequests,
    openSocketCount: sockets.size,
    upgradedSocketCount: upgradedSockets.size,
  })))
  eventLoopMonitor.start()
  log.info({ host: options.host, port }, 'Edge gateway started')

  let closed = false
  return {
    port,
    endpointUrl,
    updateTargets(nextTargets): void {
      targets = normalizeTargets(nextTargets)
      log.info({
        apiAvailable: Boolean(targets.apiUrl),
        realtimeAvailable: Boolean(targets.realtimeUrl),
      }, 'Edge targets updated')
    },
    async close(): Promise<void> {
      if (closed) return
      closed = true
      eventLoopMonitor.stop()
      await closeServer(server, sockets)
      apiAgent.destroy()
      log.info({ port }, 'Edge gateway stopped')
    },
  }
}

function normalizeTargets(targets: EdgeTargets): EdgeTargets {
  return {
    apiUrl: targets.apiUrl ? normalizeLoopbackTarget(targets.apiUrl, ['http:', 'https:']) : undefined,
    realtimeUrl: targets.realtimeUrl
      ? normalizeLoopbackTarget(targets.realtimeUrl, ['ws:', 'wss:', 'http:', 'https:'])
      : undefined,
  }
}

function normalizeLoopbackTarget(value: string, protocols: string[]): string {
  const target = new URL(value)
  if (!protocols.includes(target.protocol)) throw new Error(`Unsupported Edge target protocol: ${target.protocol}`)
  if (!isLoopbackHost(target.hostname)) throw new Error(`Edge target must be loopback: ${target.hostname}`)
  target.username = ''
  target.password = ''
  target.search = ''
  target.hash = ''
  target.pathname = ''
  return target.toString().replace(/\/$/, '')
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost'
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => { cleanup(); reject(error) }
    const onListening = (): void => { cleanup(); resolve() }
    const cleanup = (): void => {
      server.off('error', onError)
      server.off('listening', onListening)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

function closeServer(server: Server, sockets: Set<Socket>): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    for (const socket of sockets) socket.destroy()
  })
}

function serverPort(server: Server): number {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Edge server did not expose a TCP port')
  return address.port
}

function formatPublicHost(host: string): string {
  const publicHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
  return publicHost.includes(':') && !publicHost.startsWith('[') ? `[${publicHost}]` : publicHost
}

function sendJson(response: ServerResponse, status: number, body: Record<string, string>): void {
  if (response.writableEnded) return
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'connection': 'close',
    'content-length': Buffer.byteLength(payload),
    'content-type': 'application/json',
  })
  response.end(payload)
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  if (socket.destroyed) return
  const payload = JSON.stringify({ error: reason.toLowerCase().replaceAll(' ', '-') })
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\n`
      + 'Connection: close\r\n'
      + 'Content-Type: application/json\r\n'
      + `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n`
      + payload,
  )
}

function logProxyError(target: 'api' | 'realtime', request: IncomingMessage, error: Error): void {
  log.warn({
    err: error,
    target,
    method: request.method,
    path: safePath(request.url),
  }, 'Edge proxy request failed')
}

function isWebSocketRequest(request: IncomingMessage): boolean {
  return request.headers.upgrade?.toLowerCase() === 'websocket'
}

function isServerResponse(value: ServerResponse | Socket): value is ServerResponse {
  return 'writeHead' in value && typeof value.writeHead === 'function'
}

function safePath(value: string | undefined): string {
  try {
    return new URL(value ?? '/', 'http://edge.local').pathname
  } catch {
    return '/'
  }
}
