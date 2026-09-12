type MessageHandler = (msg: Record<string, unknown>) => void
type EndpointResolver = () => Promise<string>

export const WS_HEARTBEAT_INTERVAL_MS = 15_000
export const WS_HEARTBEAT_TIMEOUT_MS = 30_000
const WS_RECONNECT_DELAY_MS = 3_000

export class WSClient {
  private ws: WebSocket | null = null
  private handlers = new Map<string, Set<MessageHandler>>()
  private requestCounter = 0
  private pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _connected = false
  private endpoint: string | EndpointResolver = ''
  private connectGeneration = 0
  private intentionalClose = false
  private currentSubscriptions = new Set<string>()
  /** 每个 session 的订阅方数量：多个面板/组件共享一条连接，卸载只减自己的引用，归零才真正退订。 */
  private subscriptionRefs = new Map<string, number>()
  private hasConnectedBefore = false
  private cursors = new Map<string, { streamGeneration: string; sequence: number }>()
  private eventListenersReady = false
  private pendingSubscriptionRestore = false
  private pendingRestoreNeedsResume = false
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private lastInboundAt = 0

  get connected() { return this._connected }

  connect(endpoint: string | EndpointResolver) {
    this.endpoint = endpoint
    const generation = ++this.connectGeneration
    if (typeof endpoint === 'string') {
      this.open(endpoint, generation)
      return
    }
    void endpoint().then(
      (url) => this.open(url, generation),
      (error) => {
        if (generation !== this.connectGeneration) return
        this._connected = false
        this.emit('connection', { connected: false, message: toErrorMessage(error) })
      },
    )
  }

  private open(url: string, generation: number) {
    if (generation !== this.connectGeneration) return
    this.intentionalClose = true
    this.stopHeartbeat()
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.ws) { this.detachSocket(this.ws); this.ws.close(); this.ws = null }

    this.rejectPendingRequests()

    this.intentionalClose = false
    try {
      this.ws = new WebSocket(url)
    } catch (error) {
      this._connected = false
      this.emit('connection', { connected: false, message: toErrorMessage(error) })
      return
    }
    const socket = this.ws

    this.ws.onopen = () => {
      if (this.ws !== socket) return
      this._connected = true
      this.startHeartbeat(socket)
      this.emit('connection', { connected: true })
      // Emit 'reconnected' after the first successful connect so subscribers
      // can refresh state that may have gone stale during the disconnect.
      // The onclose/onerror race in some WebSocket impls can leave React's
      // `connected` state stuck at false; this event bypasses that.
      const reconnecting = this.hasConnectedBefore
      if (reconnecting) {
        this.emit('reconnected', {})
      }
      this.hasConnectedBefore = true
      this.restoreSubscriptions(reconnecting)
    }

    this.ws.onclose = (event) => {
      if (this.ws !== socket) return
      this.rejectPendingRequests()
      this.stopHeartbeat()
      this._connected = false
      this.emit('connection', { connected: false, code: event.code, reason: event.reason })
      if (!this.intentionalClose) {
        this.scheduleReconnect()
      }
    }

    // Per the WebSocket spec, an onerror is always followed by onclose. We
    // intentionally do NOT emit `connected: false` here: onerror and onclose
    // firing in close succession (or an old socket's onerror firing after a
    // new socket has already opened) used to flip the React `connected` state
    // back to false even though the new connection was healthy. onclose is
    // the single source of truth for disconnection.
    this.ws.onerror = () => {
      if (this.ws !== socket) return
    }

    this.ws.onmessage = (event) => {
      if (this.ws !== socket) return
      this.lastInboundAt = Date.now()
      try {
        const msg = JSON.parse(event.data as string)
        this.captureCursor(msg)
        if (msg.requestId && this.pendingRequests.has(msg.requestId)) {
          const pending = this.pendingRequests.get(msg.requestId)!
          this.pendingRequests.delete(msg.requestId)
          if (msg.type === 'error') pending.reject(new Error(msg.message))
          else pending.resolve(msg.data)
          return
        }
        this.emit(msg.type, msg)
      } catch {
        // ignore parse errors
      }
    }
  }

  private reconnect() {
    if (this.endpoint) this.connect(this.endpoint)
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => this.reconnect(), WS_RECONNECT_DELAY_MS)
  }

  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat()
    this.lastInboundAt = Date.now()
    this.heartbeatTimer = setInterval(() => {
      if (this.ws !== socket || socket.readyState !== WebSocket.OPEN) return
      if (Date.now() - this.lastInboundAt >= WS_HEARTBEAT_TIMEOUT_MS) {
        this.rejectPendingRequests()
        this.stopHeartbeat()
        this.detachSocket(socket)
        this.ws = null
        socket.close()
        this._connected = false
        this.emit('connection', { connected: false, reason: 'heartbeat-timeout' })
        if (!this.intentionalClose) this.scheduleReconnect()
        return
      }
      socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }))
    }, WS_HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    this.lastInboundAt = 0
  }

  disconnect() {
    this.rejectPendingRequests()
    this.connectGeneration += 1
    this.intentionalClose = true
    this.stopHeartbeat()
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.ws) { this.detachSocket(this.ws); this.ws.close(); this.ws = null }
    this._connected = false
  }

  private captureCursor(msg: Record<string, unknown>): void {
    if (typeof msg.sessionId !== 'string'
      || typeof msg.streamGeneration !== 'string'
      || typeof msg.sequence !== 'number') return
    this.cursors.set(msg.sessionId, {
      streamGeneration: msg.streamGeneration,
      sequence: msg.sequence,
    })
  }

  private detachSocket(socket: WebSocket): void {
    socket.onopen = null
    socket.onclose = null
    socket.onerror = null
    socket.onmessage = null
  }

  private rejectPendingRequests(): void {
    const pending = [...this.pendingRequests.values()]
    this.pendingRequests.clear()
    pending.forEach(request => request.reject(new Error('连接已断开，请恢复连接后重试')))
  }

  async request(msg: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 未连接')
    }

    const requestId = `req-${++this.requestCounter}`
    const payload = { ...msg, requestId }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error('请求超时'))
      }, 15000)

      this.pendingRequests.set(requestId, {
        resolve: (v) => { clearTimeout(timeout); resolve(v) },
        reject: (e) => { clearTimeout(timeout); reject(e) },
      })

      try { this.ws!.send(JSON.stringify(payload)) }
      catch (error) {
        this.pendingRequests.delete(requestId)
        clearTimeout(timeout)
        reject(error)
      }
    })
  }

  send(msg: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(msg))
  }

  subscribe(sessionIds: string[]) {
    const newlySubscribed: string[] = []
    sessionIds.forEach(id => {
      const refs = (this.subscriptionRefs.get(id) ?? 0) + 1
      this.subscriptionRefs.set(id, refs)
      if (refs === 1) {
        this.currentSubscriptions.add(id)
        newlySubscribed.push(id)
      }
    })
    if (!this.eventListenersReady) {
      this.pendingSubscriptionRestore = true
      return
    }
    if (newlySubscribed.length) this.send({ type: 'subscribe', sessionIds: newlySubscribed })
  }

  unsubscribe(sessionIds: string[]) {
    const dropped: string[] = []
    sessionIds.forEach(id => {
      const refs = (this.subscriptionRefs.get(id) ?? 0) - 1
      if (refs > 0) {
        this.subscriptionRefs.set(id, refs)
        return
      }
      this.subscriptionRefs.delete(id)
      if (this.currentSubscriptions.delete(id)) dropped.push(id)
    })
    if (dropped.length) this.send({ type: 'unsubscribe', sessionIds: dropped })
  }

  acknowledgeResync(sessionId?: string) {
    if (sessionId) this.cursors.delete(sessionId)
    else this.cursors.clear()
    this.send({ type: 'resume', cursors: Object.fromEntries(this.cursors) })
  }

  setEventListenersReady(ready: boolean): void {
    this.eventListenersReady = ready
    if (!ready || !this.pendingSubscriptionRestore || !this._connected) return
    const resume = this.pendingRestoreNeedsResume
    this.pendingSubscriptionRestore = false
    this.pendingRestoreNeedsResume = false
    this.restoreSubscriptions(resume)
  }

  sendPrompt(sessionId: string, content: string) {
    // 防御性兜底订阅（不占引用计数）：prompt 期间确保事件可达；
    // 正常的订阅生命周期仍由各组件的 subscribe/unsubscribe 配对管理。
    this.currentSubscriptions.add(sessionId)
    this.send({ type: 'prompt', sessionId, content })
  }

  on(event: string, handler: MessageHandler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(handler)
    return () => this.handlers.get(event)?.delete(handler)
  }

  off(event: string, handler: MessageHandler) {
    this.handlers.get(event)?.delete(handler)
  }

  private emit(event: string, data: Record<string, unknown>) {
    this.handlers.get(event)?.forEach(h => h(data))
    this.handlers.get('*')?.forEach(h => h({ ...data, _event: event }))
  }

  private restoreSubscriptions(reconnecting: boolean): void {
    if (this.currentSubscriptions.size === 0) return
    if (!this.eventListenersReady) {
      this.pendingSubscriptionRestore = true
      this.pendingRestoreNeedsResume ||= reconnecting
      return
    }
    this.send({ type: 'subscribe', sessionIds: [...this.currentSubscriptions] })
    if (reconnecting && this.cursors.size > 0) {
      this.send({ type: 'resume', cursors: Object.fromEntries(this.cursors) })
    }
  }
}

export const wsClient = new WSClient()

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'WebSocket connection failed'
}
