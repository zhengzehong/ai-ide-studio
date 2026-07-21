import type { WebSocket, WebSocketServer } from 'ws'
import type { IncomingMessage } from 'http'
import type { ClientMessage, ServerMessage } from '../types/ws-protocol.js'
import { createChildLogger } from '../core/logger.js'
import { dispatchRpc } from './rpc/registry.js'
import { sessionShareStore } from '../store/session-shares.js'
import type { RpcClientState } from './rpc/types.js'

const log = createChildLogger('ws')

const clients = new Map<WebSocket, RpcClientState>()

interface BroadcastOptions {
  skipToolCallFilter?: boolean
}

function shouldHideToolCallForState(state: RpcClientState, sessionId: string): boolean {
  if (state.authMode !== 'guest' || !state.shareToken) return false
  const share = sessionShareStore.getByToken(state.shareToken)
  if (!share || share.session_id !== sessionId) return false
  return share.tool_call_visibility === 'hide'
}

export function buildPayloadForState(msg: ServerMessage, state: RpcClientState, sessionId: string): string {
  if (msg.type !== 'session:update' || !shouldHideToolCallForState(state, sessionId)) {
    return JSON.stringify(msg)
  }
  const data = msg.data as unknown as Record<string, unknown>
  const filtered: Record<string, unknown> = { ...data }
  delete filtered.toolCall
  delete filtered.toolCallUpdate
  return JSON.stringify({ ...msg, data: filtered })
}

/** 测试专用:注册一个 ws+state 到 clients,返回注销函数。 */
export function __registerClientForTest(ws: WebSocket, state: RpcClientState): () => void {
  clients.set(ws, state)
  return () => { clients.delete(ws) }
}

/** 测试专用:判断 state 是否应隐藏 toolCall。 */
export function __shouldHideToolCallForState(state: RpcClientState, sessionId: string): boolean {
  return shouldHideToolCallForState(state, sessionId)
}

export function broadcastToSubscribers(sessionId: string, msg: ServerMessage, _opts?: BroadcastOptions): void {
  const subscribers: Array<{ ws: WebSocket; state: RpcClientState }> = []
  for (const [ws, state] of clients) {
    if (state.subscriptions.has(sessionId)) subscribers.push({ ws, state })
  }

  if (subscribers.length === 0) return

  let subscriberCount = 0
  let deliveredCount = 0
  for (const { ws, state } of subscribers) {
    subscriberCount++
    if (ws.readyState === ws.OPEN) {
      ws.send(buildPayloadForState(msg, state, sessionId))
      deliveredCount++
    }
  }
  if (msg.type === 'session:update') {
    const data = msg.data as unknown as Record<string, unknown>
    const hasToolCall = !!(data.toolCall || data.toolCallUpdate)
    const hasContent = !!(data.contentDelta || data.content)
    const isLifecycle = typeof data.eventType === 'string' && data.eventType.startsWith('lifecycle.')
    if (hasToolCall || hasContent || isLifecycle) {
      log.debug(
        {
          sessionId,
          msgType: msg.type,
          eventType: data.eventType,
          hasToolCall,
          hasContent,
          hasThinking: !!data.thinking,
          toolCallId: (data.toolCall as { id?: string } | undefined)?.id || (data.toolCallUpdate as { id?: string } | undefined)?.id,
          subscriberCount,
          deliveredCount,
        },
        'broadcast session:update',
      )
    }
  } else if (msg.type === 'session:done') {
    log.info(
      { sessionId, msgType: msg.type, stopReason: msg.stopReason, hasError: !!msg.error, subscriberCount, deliveredCount },
      'broadcast session:done',
    )
  }
}

export function broadcastToAll(msg: ServerMessage): void {
  const payload = JSON.stringify(msg)
  let delivered = 0
  for (const [ws] of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload)
      delivered += 1
    }
  }
  if (msg.type === 'session:activity' || msg.type === 'agent:status') {
    log.debug({ type: msg.type, delivered, totalClients: clients.size }, 'broadcast to all complete')
  }
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

function sendResult(ws: WebSocket, requestId: string | undefined, data: unknown): void {
  send(ws, { type: 'result', requestId, data })
}

function sendError(ws: WebSocket, requestId: string | undefined, message: string): void {
  send(ws, { type: 'error', requestId, message })
}

export function handleWsConnection(ws: WebSocket, req: IncomingMessage, _wss: WebSocketServer): void {
  const state: RpcClientState = resolveClientState(req)
  clients.set(ws, state)
  log.debug({ totalClients: clients.size, authMode: state.authMode, hasShareToken: !!state.shareToken, sessionId: state.sessionId }, '客户端已连接')

  ws.on('message', async (raw) => {
    let msg: ClientMessage
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      sendError(ws, undefined, '无效的 JSON 消息')
      return
    }

    const start = Date.now()
    try {
      await dispatchRpc(msg, {
        state,
        sendResult: (data) => sendResult(ws, msg.requestId, data),
        sendError: (message) => sendError(ws, msg.requestId, message),
        sendOutOfBandError: (message) => sendError(ws, undefined, message),
      })
      log.debug({ type: msg.type, requestId: msg.requestId, elapsed: Date.now() - start }, 'RPC 处理完成')
    } catch (err) {
      log.error({ err, type: msg.type, requestId: msg.requestId, elapsed: Date.now() - start }, 'RPC 处理失败')
      sendError(ws, msg.requestId, err instanceof Error ? err.message : '未知错误')
    }
  })

  ws.on('close', () => {
    clients.delete(ws)
    log.debug({ totalClients: clients.size }, '客户端已断开')
  })
}

function resolveClientState(req: IncomingMessage): RpcClientState {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const shareToken = url.searchParams.get('shareToken')
  if (shareToken) {
    const share = sessionShareStore.getByToken(shareToken)
    if (share) {
      const guestId = url.searchParams.get('guestId') ?? undefined
      const guestName = url.searchParams.get('guestName') ?? undefined
      return {
        subscriptions: new Set(),
        authMode: 'guest',
        shareToken,
        guestId,
        guestName,
        sessionId: share.session_id,
      }
    }
  }
  return { subscriptions: new Set(), authMode: 'owner' }
}
