import EventSource from 'eventsource'
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
  private es: EventSource | null = null
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
    if (!this.stopped) {
      this.connectOnce()
    }
  }

  private connectOnce(): void {
    if (this.stopped) return
    const url = `${this.hubUrl}/hub/v1/agents/${this.registrationId}/stream`
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` }
    if (this.lastEventId) headers['Last-Event-ID'] = this.lastEventId

    let es: EventSource
    try {
      es = new EventSource(url, { headers })
    } catch (e) {
      this.handlers.onError(e as Error)
      this.scheduleReconnect()
      return
    }
    this.es = es

    es.addEventListener('connected', () => {
      this.handlers.onConnected()
    })

    es.addEventListener('task', (event: unknown) => {
      const e = event as { data?: string; lastEventId?: string }
      if (e.lastEventId) this.lastEventId = e.lastEventId
      try {
        const data = JSON.parse(e.data || '{}') as TaskEventData
        this.handlers.onTask(data, e.lastEventId || '')
      } catch (err) {
        this.handlers.onError(err as Error)
      }
    })

    es.addEventListener('result', (event: unknown) => {
      const e = event as { data?: string; lastEventId?: string }
      if (e.lastEventId) this.lastEventId = e.lastEventId
      try {
        const data = JSON.parse(e.data || '{}') as ResultEventData
        this.handlers.onResult(data, e.lastEventId || '')
      } catch (err) {
        this.handlers.onError(err as Error)
      }
    })

    es.addEventListener('cancel', (event: unknown) => {
      const e = event as { lastEventId?: string }
      if (e.lastEventId) this.lastEventId = e.lastEventId
    })

    es.onerror = () => {
      this.es = null
      if (this.stopped) return
      this.handlers.onError(new Error('SSE 连接断开'))
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connectOnce()
    }, RECONNECT_DELAY_MS)
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.es) {
      this.es.close()
      this.es = null
    }
    log.debug({ registrationId: this.registrationId }, 'SSE 客户端已关闭')
  }
}
