import type { ClientMessage, RealtimeCursor, ServerMessage } from '../types/ws-protocol.js'
import { RealtimeOutboundQueue } from './outbound-queue.js'
import type { RealtimeConnectionClaims, RealtimeDelivery, RealtimeRpcState } from './protocol.js'

export interface RealtimeSocket {
  readonly OPEN: number
  readyState: number
  bufferedAmount: number
  send(payload: string, callback?: (error?: Error) => void): void
  close(code: number, reason: string): void
}

export interface RealtimeHubOptions {
  maxQueueMessages: number
  maxQueueBytes: number
  maxBufferedBytes: number
  flushIntervalMs: number
  onLegacyRpc?: (input: {
    bridgeRequestId: string
    connectionId: string
    message: ClientMessage
    state: RealtimeRpcState
  }) => void
  legacyRpcEnabled?: boolean
}

interface ConnectionRecord {
  id: string
  socket: RealtimeSocket
  claims: RealtimeConnectionClaims
  subscriptions: Set<string>
  cursors: Map<string, RealtimeCursor>
  queue: RealtimeOutboundQueue
  sending: boolean
  flushTimer?: NodeJS.Timeout
}

export class RealtimeHub {
  private readonly connections = new Map<string, ConnectionRecord>()
  private readonly sessionSubscribers = new Map<string, Set<string>>()
  private bridgeSequence = 0

  constructor(private readonly options: RealtimeHubOptions) {}

  get connectionCount(): number {
    return this.connections.size
  }

  addConnection(id: string, socket: RealtimeSocket, claims: RealtimeConnectionClaims): void {
    this.removeConnection(id)
    this.connections.set(id, {
      id,
      socket,
      claims,
      subscriptions: new Set(),
      cursors: new Map(),
      queue: new RealtimeOutboundQueue({
        maxMessages: this.options.maxQueueMessages,
        maxBytes: this.options.maxQueueBytes,
      }),
      sending: false,
    })
  }

  removeConnection(id: string): void {
    const connection = this.connections.get(id)
    if (!connection) return
    if (connection.flushTimer) clearTimeout(connection.flushTimer)
    for (const sessionId of connection.subscriptions) this.removeSubscription(id, sessionId)
    connection.queue.clear()
    this.connections.delete(id)
  }

  handleClientMessage(connectionId: string, message: ClientMessage): void {
    const connection = this.connections.get(connectionId)
    if (!connection) return
    if (message.type === 'subscribe') {
      this.subscribe(connection, stringArray(message.sessionIds), message.requestId)
      return
    }
    if (message.type === 'unsubscribe') {
      const sessionIds = stringArray(message.sessionIds)
      for (const sessionId of sessionIds) this.removeSubscription(connectionId, sessionId)
      this.enqueue(connection, { type: 'result', requestId: message.requestId, data: { unsubscribed: sessionIds } })
      return
    }
    if (message.type === 'ping') {
      this.enqueue(connection, {
        type: 'pong',
        timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
      })
      return
    }
    if (message.type === 'resume') {
      connection.queue.acknowledgeResync()
      this.enqueue(connection, { type: 'resume:ack', cursors: Object.fromEntries(connection.cursors) })
      return
    }
    if (this.options.legacyRpcEnabled === false || !this.options.onLegacyRpc) {
      this.enqueue(connection, {
        type: 'error',
        requestId: message.requestId,
        message: 'Legacy WebSocket RPC is disabled; use HTTP Command/Query APIs',
      })
      return
    }
    this.options.onLegacyRpc({
      bridgeRequestId: `realtime-rpc-${++this.bridgeSequence}`,
      connectionId,
      message,
      state: this.rpcState(connection),
    })
  }

  applyLegacyFrame(connectionId: string, message: ServerMessage): void {
    const connection = this.connections.get(connectionId)
    if (connection) this.enqueue(connection, message)
  }

  applyLegacySubscriptions(connectionId: string, subscriptions: readonly string[]): void {
    const connection = this.connections.get(connectionId)
    if (!connection) return
    for (const current of [...connection.subscriptions]) this.removeSubscription(connectionId, current)
    for (const sessionId of subscriptions) this.addSubscription(connection, sessionId)
  }

  deliver(delivery: RealtimeDelivery): void {
    const targets = delivery.scope === 'session'
      ? [...(this.sessionSubscribers.get(delivery.sessionId) ?? [])]
      : [...this.connections.keys()]
    if (targets.length === 0) return

    for (const connectionId of targets) {
      const connection = this.connections.get(connectionId)
      if (!connection || !this.canReceive(connection, delivery)) continue
      const message = filterForClaims(delivery.message, connection.claims)
      if (this.hasCursorGap(connection, message)) {
        const sessionId = 'sessionId' in message ? message.sessionId : undefined
        connection.queue.enqueueResync(sessionId, 'stream-cursor-gap')
        this.flush(connection)
        continue
      }
      this.enqueue(connection, message)
    }
  }

  close(): void {
    for (const connection of this.connections.values()) {
      if (connection.flushTimer) clearTimeout(connection.flushTimer)
      connection.socket.close(1001, 'Realtime service stopping')
      connection.queue.clear()
    }
    this.connections.clear()
    this.sessionSubscribers.clear()
  }

  private subscribe(connection: ConnectionRecord, sessionIds: string[], requestId?: string): void {
    if (connection.claims.authMode === 'guest') {
      const allowed = connection.claims.sessionId
      if (!allowed || sessionIds.some((sessionId) => sessionId !== allowed)) {
        this.enqueue(connection, { type: 'error', requestId, message: 'Guest may only subscribe to the shared session' })
        return
      }
    }
    for (const sessionId of sessionIds) this.addSubscription(connection, sessionId)
    this.enqueue(connection, { type: 'result', requestId, data: { subscribed: sessionIds } })
  }

  private addSubscription(connection: ConnectionRecord, sessionId: string): void {
    if (connection.subscriptions.has(sessionId)) return
    connection.subscriptions.add(sessionId)
    const subscribers = this.sessionSubscribers.get(sessionId) ?? new Set<string>()
    subscribers.add(connection.id)
    this.sessionSubscribers.set(sessionId, subscribers)
  }

  private removeSubscription(connectionId: string, sessionId: string): void {
    const connection = this.connections.get(connectionId)
    connection?.subscriptions.delete(sessionId)
    const subscribers = this.sessionSubscribers.get(sessionId)
    subscribers?.delete(connectionId)
    if (subscribers?.size === 0) this.sessionSubscribers.delete(sessionId)
  }

  private enqueue(connection: ConnectionRecord, message: ServerMessage): void {
    const result = connection.queue.enqueue(message)
    if (result.closeRecommended) {
      connection.socket.close(1013, 'Realtime client cannot keep up; refresh snapshot')
      this.removeConnection(connection.id)
      return
    }
    this.flush(connection)
  }

  private flush(connection: ConnectionRecord): void {
    if (connection.sending || connection.socket.readyState !== connection.socket.OPEN) return
    if (connection.socket.bufferedAmount > this.options.maxBufferedBytes) {
      connection.queue.enqueueResync(undefined, 'websocket-buffered-amount')
      this.scheduleFlush(connection)
      return
    }
    const frame = connection.queue.shift()
    if (!frame) return
    connection.sending = true
    connection.socket.send(frame.payload, (error) => {
      connection.sending = false
      if (error) {
        connection.socket.close(1011, 'Realtime send failed')
        this.removeConnection(connection.id)
        return
      }
      if (frame.cursor) {
        connection.cursors.set(frame.cursor.sessionId, {
          streamGeneration: frame.cursor.streamGeneration,
          sequence: frame.cursor.sequence,
        })
      }
      this.flush(connection)
    })
  }

  private scheduleFlush(connection: ConnectionRecord): void {
    if (connection.flushTimer) return
    connection.flushTimer = setTimeout(() => {
      connection.flushTimer = undefined
      this.flush(connection)
    }, this.options.flushIntervalMs)
  }

  private hasCursorGap(connection: ConnectionRecord, message: ServerMessage): boolean {
    if (!('sessionId' in message) || !('streamGeneration' in message) || !('sequence' in message)) return false
    if (typeof message.streamGeneration !== 'string' || typeof message.sequence !== 'number') return false
    const previous = connection.cursors.get(message.sessionId)
    if (!previous) return false
    return previous.streamGeneration !== message.streamGeneration
      || message.sequence !== previous.sequence + 1
  }

  private canReceive(connection: ConnectionRecord, delivery: RealtimeDelivery): boolean {
    if (connection.claims.authMode === 'owner') return true
    if (delivery.scope === 'session') return delivery.sessionId === connection.claims.sessionId
    return 'sessionId' in delivery.message && delivery.message.sessionId === connection.claims.sessionId
  }

  private rpcState(connection: ConnectionRecord): RealtimeRpcState {
    return { ...connection.claims, subscriptions: [...connection.subscriptions] }
  }
}

function filterForClaims(message: ServerMessage, claims: RealtimeConnectionClaims): ServerMessage {
  if (message.type !== 'session:update' || claims.toolCallVisibility !== 'hide') return message
  const data = { ...message.data }
  delete data.toolCall
  delete data.toolCallUpdate
  return { ...message, data }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
