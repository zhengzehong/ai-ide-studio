type MessageHandler = (msg: Record<string, unknown>) => void
type EndpointResolver = () => Promise<string>

class WSClient {
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
  private hasConnectedBefore = false
  private cursors = new Map<string, { streamGeneration: string; sequence: number }>()
  private eventListenersReady = false
  private pendingSubscriptionRestore = false
  private pendingRestoreNeedsResume = false

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
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.ws) { this.detachSocket(this.ws); this.ws.close(); this.ws = null }

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
      this._connected = false
      this.emit('connection', { connected: false, code: event.code, reason: event.reason })
      if (!this.intentionalClose) {
        this.reconnectTimer = setTimeout(() => this.reconnect(), 3000)
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

  disconnect() {
    this.connectGeneration += 1
    this.intentionalClose = true
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

      this.ws!.send(JSON.stringify(payload))
    })
  }

  send(msg: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(msg))
  }

  subscribe(sessionIds: string[]) {
    sessionIds.forEach(id => this.currentSubscriptions.add(id))
    if (!this.eventListenersReady) {
      this.pendingSubscriptionRestore = true
      return
    }
    this.send({ type: 'subscribe', sessionIds })
  }

  unsubscribe(sessionIds: string[]) {
    sessionIds.forEach(id => this.currentSubscriptions.delete(id))
    this.send({ type: 'unsubscribe', sessionIds })
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
