type MessageHandler = (msg: Record<string, unknown>) => void

class WSClient {
  private ws: WebSocket | null = null
  private handlers = new Map<string, Set<MessageHandler>>()
  private requestCounter = 0
  private pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _connected = false
  private url = ''
  private intentionalClose = false
  private currentSubscriptions = new Set<string>()

  get connected() { return this._connected }

  connect(url: string) {
    this.url = url
    this.intentionalClose = true
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.ws) { this.ws.close(); this.ws = null }

    this.intentionalClose = false
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this._connected = true
      this.emit('connection', { connected: true })
      if (this.currentSubscriptions.size > 0) {
        this.send({ type: 'subscribe', sessionIds: [...this.currentSubscriptions] })
      }
    }

    this.ws.onclose = () => {
      this._connected = false
      this.emit('connection', { connected: false })
      if (!this.intentionalClose) {
        this.reconnectTimer = setTimeout(() => this.reconnect(), 3000)
      }
    }

    this.ws.onerror = () => {}

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string)
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
    if (this.url) this.connect(this.url)
  }

  disconnect() {
    this.intentionalClose = true
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.ws) { this.ws.close(); this.ws = null }
    this._connected = false
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
    this.send({ type: 'subscribe', sessionIds })
  }

  unsubscribe(sessionIds: string[]) {
    sessionIds.forEach(id => this.currentSubscriptions.delete(id))
    this.send({ type: 'unsubscribe', sessionIds })
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
}

export const wsClient = new WSClient()
