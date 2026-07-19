import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import { RealtimeHub } from './hub.js'
import type { RealtimeConnectionClaims, RealtimeIpcPayload } from './protocol.js'
import type { ClientMessage } from '../types/ws-protocol.js'
import type { ServerMessage } from '../types/ws-protocol.js'

export interface RealtimeServiceOptions {
  host: string
  port: number
  legacyRpcEnabled: boolean
  maxQueueMessages: number
  maxQueueBytes: number
  maxBufferedBytes: number
  flushIntervalMs: number
  sendIpc: (payload: RealtimeIpcPayload) => Promise<void>
}

interface PendingConnection {
  socket: WebSocket
  bufferedMessages: ClientMessage[]
}

export interface RealtimeServiceHandle {
  port: number
  handleIpc(payload: RealtimeIpcPayload): Promise<void>
  handleRuntimeMessage(message: ServerMessage): void
  close(): Promise<void>
}

export async function startRealtimeService(
  options: RealtimeServiceOptions,
): Promise<RealtimeServiceHandle> {
  const pending = new Map<string, PendingConnection>()
  const hub = new RealtimeHub({
    maxQueueMessages: options.maxQueueMessages,
    maxQueueBytes: options.maxQueueBytes,
    maxBufferedBytes: options.maxBufferedBytes,
    flushIntervalMs: options.flushIntervalMs,
    legacyRpcEnabled: options.legacyRpcEnabled,
    onLegacyRpc: (request) => {
      void options.sendIpc({ type: 'rpc.request', ...request })
    },
  })
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"status":"ok"}')
  })
  const wss = new WebSocketServer({ server })

  wss.on('connection', (socket, request) => {
    const connectionId = `rt-${randomUUID()}`
    const bufferedMessages: ClientMessage[] = []
    pending.set(connectionId, { socket, bufferedMessages })
    socket.on('message', (raw) => {
      const message = parseClientMessage(raw.toString())
      if (!message) return
      if (pending.has(connectionId)) bufferedMessages.push(message)
      else hub.handleClientMessage(connectionId, message)
    })
    socket.on('close', () => {
      pending.delete(connectionId)
      hub.removeConnection(connectionId)
    })
    const url = new URL(request.url ?? '/', 'http://localhost')
    void options.sendIpc({
      type: 'auth.request',
      connectionId,
      token: url.searchParams.get('token') ?? undefined,
      shareToken: url.searchParams.get('shareToken') ?? undefined,
      guestId: url.searchParams.get('guestId') ?? undefined,
      guestName: url.searchParams.get('guestName') ?? undefined,
    })
  })

  await listen(server, options.host, options.port)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Realtime server did not expose a TCP port')

  const handleIpc = async (payload: RealtimeIpcPayload): Promise<void> => {
    if (payload.type === 'auth.result') {
      const connection = pending.get(payload.connectionId)
      if (!connection) return
      pending.delete(payload.connectionId)
      if (!payload.claims || payload.error) {
        connection.socket.close(1008, payload.error ?? 'Unauthorized')
        return
      }
      hub.addConnection(payload.connectionId, asRealtimeSocket(connection.socket), payload.claims)
      for (const message of connection.bufferedMessages) hub.handleClientMessage(payload.connectionId, message)
      return
    }
    if (payload.type === 'event') {
      hub.deliver(payload.delivery)
      return
    }
    if (payload.type === 'rpc.frame') {
      hub.applyLegacyFrame(payload.connectionId, payload.message)
      return
    }
    if (payload.type === 'rpc.complete') {
      hub.applyLegacySubscriptions(payload.connectionId, payload.subscriptions)
    }
  }

  return {
    port: address.port,
    handleIpc,
    handleRuntimeMessage(message) {
      const sessionId = 'sessionId' in message && typeof message.sessionId === 'string'
        ? message.sessionId
        : undefined
      hub.deliver(sessionId
        ? { scope: 'session', sessionId, message }
        : { scope: 'all', message })
    },
    close: async () => {
      hub.close()
      for (const connection of pending.values()) connection.socket.close(1001, 'Realtime service stopping')
      pending.clear()
      await closeWebSocketServer(wss)
      await closeHttpServer(server)
    },
  }
}

function asRealtimeSocket(socket: WebSocket): WebSocket & { readonly OPEN: number } {
  return socket as WebSocket & { readonly OPEN: number }
}

function parseClientMessage(raw: string): ClientMessage | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as ClientMessage
      : undefined
  } catch {
    return undefined
  }
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onListening = (): void => { cleanup(); resolve() }
    const onError = (error: Error): void => { cleanup(); reject(error) }
    const cleanup = (): void => {
      server.off('listening', onListening)
      server.off('error', onError)
    }
    server.once('listening', onListening)
    server.once('error', onError)
    server.listen(port, host)
  })
}

function closeWebSocketServer(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    wss.close((error) => error && error.message !== 'The server is not running'
      ? reject(error)
      : resolve())
  })
}

function closeHttpServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

export function normalizeClaims(value: RealtimeConnectionClaims): RealtimeConnectionClaims {
  return { ...value }
}
