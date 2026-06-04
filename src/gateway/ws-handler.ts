import type { WebSocket, WebSocketServer } from 'ws'
import type { IncomingMessage } from 'http'
import type { ClientMessage, ServerMessage } from '../types/ws-protocol.js'
import { events } from '../core/events.js'
import { createChildLogger } from '../core/logger.js'
import { dispatchRpc } from './rpc/registry.js'
import type { RpcClientState } from './rpc/types.js'

const log = createChildLogger('ws')

const clients = new Map<WebSocket, RpcClientState>()

export function broadcastToSubscribers(sessionId: string, msg: ServerMessage): void {
  const payload = JSON.stringify(msg)
  for (const [ws, state] of clients) {
    if (state.subscriptions.has(sessionId) && ws.readyState === ws.OPEN) {
      ws.send(payload)
    }
  }
}

export function broadcastToAll(msg: ServerMessage): void {
  const payload = JSON.stringify(msg)
  for (const [ws] of clients) {
    if (ws.readyState === ws.OPEN) ws.send(payload)
  }
}

events.on('session:update', (ev) => {
  broadcastToSubscribers(ev.sessionId, {
    type: 'session:update',
    sessionId: ev.sessionId,
    agentId: ev.agentId,
    data: ev.data,
  })
})

events.on('session:event', (ev) => {
  broadcastToSubscribers(ev.sessionId, {
    type: 'session:event',
    sessionId: ev.sessionId,
    agentId: ev.agentId,
    event: ev.event,
  })
})

events.on('session:done', (ev) => {
  broadcastToSubscribers(ev.sessionId, {
    type: 'session:done',
    sessionId: ev.sessionId,
    agentId: ev.agentId,
    messageId: ev.messageId,
    turnUsage: ev.turnUsage,
    stopReason: ev.stopReason,
    error: ev.error,
  })
})

events.on('session:activity', (ev) => {
  broadcastToAll({ type: 'session:activity', ...ev })
})

events.on('session:capabilities', (ev) => {
  broadcastToSubscribers(ev.sessionId, {
    type: 'session:capabilities',
    sessionId: ev.sessionId,
    capabilities: ev.capabilities,
  })
})

events.on('session:changed', (ev) => {
  broadcastToAll({ type: 'session:changed', sessionId: ev.sessionId, data: ev.data })
})

events.on('agent:status', (ev) => {
  broadcastToAll({ type: 'agent:status', agentId: ev.agentId, status: ev.status })
})

events.on('task:update', (ev) => {
  broadcastToAll({ type: 'task:update', taskId: ev.taskId, data: ev.data })
})

events.on('team:update', (ev) => {
  broadcastToAll({ type: 'team:update', teamId: ev.teamId, sessionIds: ev.sessionIds, data: ev.data })
})

events.on('rule:update', (ev) => {
  broadcastToAll({ type: 'rule:update', ruleId: ev.ruleId, data: ev.data })
})

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

function sendResult(ws: WebSocket, requestId: string | undefined, data: unknown): void {
  send(ws, { type: 'result', requestId, data })
}

function sendError(ws: WebSocket, requestId: string | undefined, message: string): void {
  send(ws, { type: 'error', requestId, message })
}

export function handleWsConnection(ws: WebSocket, _req: IncomingMessage, _wss: WebSocketServer): void {
  const state: RpcClientState = { subscriptions: new Set() }
  clients.set(ws, state)
  log.debug({ totalClients: clients.size }, '客户端已连接')

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
