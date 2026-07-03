import { createChildLogger } from '../logger.js'

const log = createChildLogger('agent-hub:sse')

export interface TaskEventData {
  message: {
    messageId?: string
    contextId?: string
    role?: string
    parts?: Array<{ type: string; text?: string; mediaType?: string }>
  }
  configuration?: {
    taskPushNotificationConfig?: {
      url?: string
      authentication?: { credentials?: string }
    }
  }
  metadata?: Record<string, unknown>
}

export interface ResultEventData {
  hubTaskId: string
  task: {
    id?: string
    contextId?: string
    status?: {
      state?: string
      timestamp?: string
      message?: {
        messageId?: string
        role?: string
        parts?: Array<{ type: string; text?: string; mediaType?: string }>
      }
    }
    artifacts?: unknown[]
  }
}

export interface SseHandlers {
  onTask: (data: TaskEventData, eventId: string) => void
  onResult: (data: ResultEventData, eventId: string) => void
  onConnected: () => void
  onError: (err: Error) => void
}

const RECONNECT_DELAY_MS = 3000

export class SseClient {
  private abortCtrl: AbortController | null = null
  private stopped = false
  private lastEventId = ''
  private reconnectTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly hubUrl: string,
    private readonly registrationId: string,
    private readonly token: string,
    private readonly handlers: SseHandlers,
  ) {}

  start(): void {
    if (!this.stopped) void this.connectOnce()
  }

  private async connectOnce(): Promise<void> {
    if (this.stopped) return
    const url = `${this.hubUrl}/hub/v1/agents/${this.registrationId}/stream`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'text/event-stream',
    }
    if (this.lastEventId) headers['Last-Event-ID'] = this.lastEventId

    this.abortCtrl = new AbortController()
    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers,
        signal: this.abortCtrl.signal,
      })
      if (!resp.ok || !resp.body) {
        throw new Error(`SSE 连接失败: HTTP ${resp.status}`)
      }
      this.handlers.onConnected()
      await this.readStream(resp.body)
    } catch (e) {
      if (this.stopped) return
      const err = e as Error
      if (err.name === 'AbortError') return
      this.handlers.onError(err)
      this.scheduleReconnect()
    }
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let curEvent = ''
    let curData = ''

    try {
      while (!this.stopped) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const raw of lines) {
          const line = raw.replace(/\r$/, '')
          if (line === '') {
            if (curEvent && curData) this.dispatch(curEvent, curData)
            curEvent = ''
            curData = ''
          } else if (line.startsWith('event:')) {
            curEvent = line.slice(6).trim()
          } else if (line.startsWith('data:')) {
            curData += (curData ? '\n' : '') + line.slice(5).trim()
          } else if (line.startsWith('id:')) {
            this.lastEventId = line.slice(3).trim()
          }
        }
      }
    } finally {
      try { reader.releaseLock() } catch { /* ignore */ }
    }

    if (!this.stopped) {
      this.handlers.onError(new Error('SSE 流意外结束'))
      this.scheduleReconnect()
    }
  }

  private dispatch(event: string, data: string): void {
    try {
      if (event === 'task') {
        this.handlers.onTask(JSON.parse(data) as TaskEventData, this.lastEventId)
      } else if (event === 'result') {
        this.handlers.onResult(JSON.parse(data) as ResultEventData, this.lastEventId)
      }
    } catch (e) {
      this.handlers.onError(e as Error)
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connectOnce()
    }, RECONNECT_DELAY_MS)
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.abortCtrl) {
      this.abortCtrl.abort()
      this.abortCtrl = null
    }
    log.debug({ registrationId: this.registrationId }, 'SSE 客户端已关闭')
  }
}
