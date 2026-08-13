import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import WebSocket, { WebSocketServer } from 'ws'
import type { AppConfig } from '../core/config.js'
import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('funasr-proxy')
const VOICE_ASR_PATH = '/api/v1/voice/asr'
const MAX_PENDING_BYTES = 512 * 1024
const UPSTREAM_CONNECT_TIMEOUT_MS = 8_000

export interface FunAsrProxyHandle {
  isUpgrade(request: IncomingMessage): boolean
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void
  close(): Promise<void>
}

export function createFunAsrProxy(config: AppConfig): FunAsrProxyHandle {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 })
  const upstreams = new Set<WebSocket>()

  wss.on('connection', (client, request) => {
    const upstreamUrl = config.funAsrWsUrl
    if (!upstreamUrl) {
      client.close(1013, 'ASR unavailable')
      return
    }
    const upstream = new WebSocket(upstreamUrl, { handshakeTimeout: UPSTREAM_CONNECT_TIMEOUT_MS })
    upstreams.add(upstream)
    const pending: Array<{ data: WebSocket.RawData; binary: boolean }> = []
    let pendingBytes = 0
    let ready = false
    let closed = false

    const closePair = (code = 1000, reason = 'ASR session ended'): void => {
      if (closed) return
      closed = true
      upstreams.delete(upstream)
      if (client.readyState === WebSocket.OPEN) client.close(code, reason)
      if (upstream.readyState === WebSocket.OPEN) upstream.close(code, reason)
      else if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate()
    }

    upstream.once('open', () => {
      ready = true
      for (const item of pending.splice(0)) upstream.send(item.data, { binary: item.binary })
      pendingBytes = 0
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'ready' }))
      log.debug({ path: request.url }, 'FunASR upstream connected')
    })
    upstream.on('message', (data, binary) => {
      if (client.readyState !== WebSocket.OPEN) return
      if (client.bufferedAmount + dataLength(data) > MAX_PENDING_BYTES) {
        closePair(1009, 'ASR client buffer exceeded')
        return
      }
      client.send(data, { binary })
    })
    upstream.once('error', (error) => {
      log.warn({ err: error }, 'FunASR upstream connection failed')
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'error', message: 'FunASR service unavailable' }))
      }
      closePair(1013, 'ASR unavailable')
    })
    upstream.once('close', (code, reason) => closePair(normalizeCloseCode(code), reason.toString() || 'ASR closed'))

    client.on('message', (data, binary) => {
      if (ready && upstream.readyState === WebSocket.OPEN) {
        if (upstream.bufferedAmount + dataLength(data) > MAX_PENDING_BYTES) {
          closePair(1009, 'ASR upstream buffer exceeded')
          return
        }
        upstream.send(data, { binary })
        return
      }
      pendingBytes += dataLength(data)
      if (pendingBytes > MAX_PENDING_BYTES) {
        closePair(1009, 'ASR buffer exceeded')
        return
      }
      pending.push({ data, binary })
    })
    client.once('close', (code, reason) => closePair(normalizeCloseCode(code), reason.toString() || 'Client closed'))
    client.once('error', (error) => {
      log.debug({ err: error }, 'FunASR client socket failed')
      closePair(1011, 'Client socket failed')
    })
  })

  return {
    isUpgrade: (request) => safePath(request.url) === VOICE_ASR_PATH,
    handleUpgrade(request, socket, head): void {
      if (!isAuthorized(request, config.localToken)) {
        rejectUpgrade(socket, 401, 'Unauthorized')
        return
      }
      if (!config.funAsrWsUrl) {
        rejectUpgrade(socket, 503, 'ASR Unavailable')
        return
      }
      wss.handleUpgrade(request, socket, head, (client) => {
        wss.emit('connection', client, request)
      })
    },
    async close(): Promise<void> {
      for (const client of wss.clients) client.terminate()
      for (const upstream of upstreams) upstream.terminate()
      if (wss.clients.size === 0) return
      await new Promise<void>((resolve, reject) => wss.close((error) => error ? reject(error) : resolve()))
    },
  }
}

function isAuthorized(request: IncomingMessage, expectedToken: string | undefined): boolean {
  if (!expectedToken) return true
  const header = request.headers['x-ai-ide-token']
  if (header === expectedToken || (Array.isArray(header) && header.includes(expectedToken))) return true
  try {
    return new URL(request.url ?? '/', 'http://gateway.local').searchParams.get('token') === expectedToken
  } catch {
    return false
  }
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  const body = JSON.stringify({ error: reason.toLowerCase().replaceAll(' ', '-') })
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: application/json\r\n`
      + `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  )
}

function safePath(value: string | undefined): string {
  try {
    return new URL(value ?? '/', 'http://gateway.local').pathname
  } catch {
    return '/'
  }
}

function dataLength(data: WebSocket.RawData): number {
  if (Array.isArray(data)) return data.reduce((total, item) => total + item.length, 0)
  return data.byteLength
}

function normalizeCloseCode(code: number): number {
  return code >= 1000 && code <= 4999 && code !== 1005 && code !== 1006 ? code : 1011
}
