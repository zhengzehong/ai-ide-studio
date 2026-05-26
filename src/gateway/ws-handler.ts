import type { WebSocket, WebSocketServer } from 'ws'
import type { IncomingMessage } from 'http'
import type { ClientMessage, ServerMessage } from '../types/ws-protocol.js'
import { events } from '../core/events.js'
import { agentStore } from '../store/agents.js'
import { sessionStore, messageStore } from '../store/sessions.js'
import { taskStore } from '../store/tasks.js'
import { ruleStore } from '../store/rules.js'
import { taskManager } from '../core/tasks.js'
import { sessionManager } from '../core/sessions.js'
import { acpHost } from '../acp/host.js'
import { getNextRunTime } from '../core/cron.js'

interface ClientState {
  subscriptions: Set<string>
}

const clients = new Map<WebSocket, ClientState>()

export function broadcastToSubscribers(sessionId: string, msg: ServerMessage) {
  const payload = JSON.stringify(msg)
  for (const [ws, state] of clients) {
    if (state.subscriptions.has(sessionId) && ws.readyState === ws.OPEN) {
      ws.send(payload)
    }
  }
}

export function broadcastToAll(msg: ServerMessage) {
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

events.on('session:done', (ev) => {
  broadcastToSubscribers(ev.sessionId, {
    type: 'session:done',
    sessionId: ev.sessionId,
    agentId: ev.agentId,
    messageId: ev.messageId,
    turnUsage: ev.turnUsage,
  })
})

events.on('session:capabilities', (ev) => {
  broadcastToSubscribers(ev.sessionId, {
    type: 'session:capabilities',
    sessionId: ev.sessionId,
    capabilities: ev.capabilities,
  })
})

events.on('agent:status', (ev) => {
  broadcastToAll({ type: 'agent:status', agentId: ev.agentId, status: ev.status })
})

events.on('task:update', (ev) => {
  broadcastToAll({ type: 'task:update', taskId: ev.taskId, data: ev.data })
})

events.on('rule:update', (ev) => {
  broadcastToAll({ type: 'rule:update', ruleId: ev.ruleId, data: ev.data })
})

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

function sendResult(ws: WebSocket, requestId: string | undefined, data: unknown) {
  send(ws, { type: 'result', requestId, data })
}

function sendError(ws: WebSocket, requestId: string | undefined, message: string) {
  send(ws, { type: 'error', requestId, message })
}

export function handleWsConnection(ws: WebSocket, _req: IncomingMessage, _wss: WebSocketServer) {
  const state: ClientState = { subscriptions: new Set() }
  clients.set(ws, state)

  ws.on('message', async (raw) => {
    let msg: ClientMessage
    try { msg = JSON.parse(raw.toString()) } catch {
      sendError(ws, undefined, '无效的 JSON 消息')
      return
    }
    try { await handleMessage(ws, state, msg) } catch (err) {
      sendError(ws, msg.requestId, err instanceof Error ? err.message : '未知错误')
    }
  })

  ws.on('close', () => { clients.delete(ws) })
}

async function handleMessage(ws: WebSocket, state: ClientState, msg: ClientMessage) {
  switch (msg.type) {
    case 'subscribe': {
      const ids = msg.sessionIds as string[]
      ids.forEach((id) => state.subscriptions.add(id))
      sendResult(ws, msg.requestId, { subscribed: ids })
      break
    }

    case 'unsubscribe': {
      const ids = msg.sessionIds as string[]
      ids.forEach((id) => state.subscriptions.delete(id))
      sendResult(ws, msg.requestId, { unsubscribed: ids })
      break
    }

    case 'prompt': {
      const sessionId = msg.sessionId as string
      const content = msg.content as string
      const images = msg.images as { data: string; mimeType: string }[] | undefined
      state.subscriptions.add(sessionId)
      sendResult(ws, msg.requestId, { status: 'streaming' })
      sessionManager.sendPrompt(sessionId, content, images).catch((err) => {
        sendError(ws, undefined, `Prompt 执行失败: ${err instanceof Error ? err.message : err}`)
      })
      break
    }

    case 'session.setModel': {
      const sessionId = msg.sessionId as string
      const modelId = msg.modelId as string
      const session = sessionStore.get(sessionId)
      if (!session) { sendError(ws, msg.requestId, '会话不存在'); break }
      await acpHost.setModel(session.agent_id, sessionId, modelId)
      sendResult(ws, msg.requestId, { modelId })
      break
    }

    case 'session.getModels': {
      const sessionId = msg.sessionId as string
      const session = sessionStore.get(sessionId)
      if (!session) { sendError(ws, msg.requestId, '会话不存在'); break }
      const caps = acpHost.getSessionCapabilities(session.agent_id, sessionId)
      sendResult(ws, msg.requestId, {
        models: caps?.models || [],
        currentModelId: caps?.currentModelId || null,
        modes: caps?.modes || [],
        currentModeId: caps?.currentModeId || null,
        supportsImages: caps?.supportsImages || false,
      })
      break
    }

    case 'session.setMode': {
      const sessionId = msg.sessionId as string
      const modeId = msg.modeId as string
      const session = sessionStore.get(sessionId)
      if (!session) { sendError(ws, msg.requestId, '会话不存在'); break }
      await acpHost.setMode(session.agent_id, sessionId, modeId)
      sendResult(ws, msg.requestId, { modeId })
      break
    }

    case 'decision': {
      const sessionId = msg.sessionId as string
      await sessionManager.sendDecision(sessionId, msg.messageId as string, msg.choice as string)
      break
    }

    case 'agents.list':
      sendResult(ws, msg.requestId, agentStore.list())
      break

    case 'agents.create': {
      const agent = agentStore.create({ type: msg.agentType as string, name: msg.name as string, runtime: msg.runtime as string })
      sendResult(ws, msg.requestId, agent)
      break
    }

    case 'sessions.list':
      sendResult(ws, msg.requestId, sessionStore.list(msg.agentId as string | undefined))
      break

    case 'sessions.create': {
      const session = await sessionManager.createSession(msg.agentId as string, msg.taskId as string | undefined)
      state.subscriptions.add(session.id)
      sendResult(ws, msg.requestId, session)
      break
    }

    case 'sessions.messages':
      sendResult(ws, msg.requestId, messageStore.list(msg.sessionId as string, { limit: msg.limit as number | undefined, before: msg.before as string | undefined }))
      break

    case 'tasks.list':
      sendResult(ws, msg.requestId, taskStore.list(msg.status as string | undefined))
      break

    case 'tasks.create': {
      const task = await taskManager.createTask({ title: msg.title as string, description: msg.description as string | undefined, assignAgentId: msg.assignAgentId as string | undefined })
      sendResult(ws, msg.requestId, task)
      break
    }

    case 'tasks.update': {
      taskManager.updateTask(msg.taskId as string, msg.status as string | undefined, msg.stage as string | undefined)
      sendResult(ws, msg.requestId, taskStore.get(msg.taskId as string))
      break
    }

    case 'rules.list':
      sendResult(ws, msg.requestId, ruleStore.list())
      break

    case 'rules.create': {
      const name = msg.name as string
      const cron = msg.cron as string
      const action = msg.action as string
      const actionConfig = msg.actionConfig as { title: string; description?: string; assignAgentId?: string }
      if (!name || !cron || !action || !actionConfig?.title) {
        sendError(ws, msg.requestId, 'name, cron, action 和 actionConfig.title 为必填项')
        break
      }
      if (cron.trim().split(/\s+/).length !== 5) {
        sendError(ws, msg.requestId, 'cron 表达式需要 5 个字段')
        break
      }
      const rule = ruleStore.create({
        name,
        cron: cron.trim(),
        action,
        actionConfig,
        description: msg.description as string | undefined,
        enabled: msg.enabled !== false,
      })
      const nextRun = getNextRunTime(rule.cron, new Date())
      if (nextRun) {
        ruleStore.update(rule.id, { next_run_at: nextRun.toISOString() })
        rule.next_run_at = nextRun.toISOString()
      }
      events.emit('rule:update', { ruleId: rule.id, data: { ...rule } })
      sendResult(ws, msg.requestId, rule)
      break
    }

    case 'rules.update': {
      const fields: Record<string, unknown> = {}
      if (msg.name !== undefined) fields.name = msg.name
      if (msg.cron !== undefined) {
        const cron = msg.cron as string
        if (cron.trim().split(/\s+/).length !== 5) {
          sendError(ws, msg.requestId, 'cron 表达式需要 5 个字段')
          break
        }
        fields.cron = cron.trim()
      }
      if (msg.action !== undefined) fields.action = msg.action
      if (msg.actionConfig !== undefined) fields.action_config = msg.actionConfig
      if (msg.description !== undefined) fields.description = msg.description
      if (msg.enabled !== undefined) fields.enabled = msg.enabled
      ruleStore.update(msg.ruleId as string, fields)
      if (fields.cron) {
        const rule = ruleStore.get(msg.ruleId as string)
        if (rule) {
          const nextRun = getNextRunTime(rule.cron, new Date())
          ruleStore.update(rule.id, { next_run_at: nextRun?.toISOString() ?? null })
        }
      }
      const updated = ruleStore.get(msg.ruleId as string)
      if (updated) {
        events.emit('rule:update', { ruleId: updated.id, data: { ...updated } })
      }
      sendResult(ws, msg.requestId, updated)
      break
    }

    case 'rules.toggle':
      ruleStore.toggle(msg.ruleId as string, msg.enabled as boolean)
      events.emit('rule:update', { ruleId: msg.ruleId as string, data: { event: 'toggled', enabled: msg.enabled } })
      sendResult(ws, msg.requestId, ruleStore.get(msg.ruleId as string))
      break

    case 'rules.delete':
      ruleStore.delete(msg.ruleId as string)
      events.emit('rule:update', { ruleId: msg.ruleId as string, data: { event: 'deleted' } })
      sendResult(ws, msg.requestId, { deleted: true })
      break

    default:
      sendError(ws, msg.requestId, `未知消息类型: ${msg.type}`)
  }
}
