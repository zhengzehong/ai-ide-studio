import type { WebSocket, WebSocketServer } from 'ws'
import type { IncomingMessage } from 'http'
import type { ClientMessage, ServerMessage } from '../types/ws-protocol.js'
import type { ToolConfig } from '../tools/types.js'
import { events } from '../core/events.js'
import { agentStore } from '../store/agents.js'
import { sessionStore, messageStore, eventStore } from '../store/sessions.js'
import { taskStore } from '../store/tasks.js'
import { ruleStore } from '../store/rules.js'
import { taskManager } from '../core/tasks.js'
import { sessionManager } from '../core/sessions.js'
import { acpHost } from '../acp/host.js'
import { isSupportedAgentRuntime, SUPPORTED_AGENT_RUNTIMES } from '../acp/adapters.js'
import { getNextRunTime } from '../core/cron.js'
import { projectStore } from '../store/projects.js'
import { templateStore } from '../store/agent-templates.js'
import { listDirectory, readFile, expandDirectory } from '../core/filesystem.js'
import { toolStore, toolBindingStore } from '../store/tools.js'
import { modelProviderStore } from '../store/model-providers.js'
import { skillStore, skillBindingStore } from '../store/skills.js'
import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('ws')

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
  log.debug({ totalClients: clients.size }, '客户端已连接')

  ws.on('message', async (raw) => {
    let msg: ClientMessage
    try { msg = JSON.parse(raw.toString()) } catch {
      sendError(ws, undefined, '无效的 JSON 消息')
      return
    }
    const start = Date.now()
    try {
      await handleMessage(ws, state, msg)
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
        supportsAudio: caps?.supportsAudio || false,
        configOptions: caps?.configOptions || [],
        commands: caps?.commands || [],
        sessionInfo: caps?.sessionInfo || null,
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

    case 'session.setConfig': {
      const sessionId = msg.sessionId as string
      const configId = msg.configId as string
      const value = msg.value as string | boolean
      const session = sessionStore.get(sessionId)
      if (!session) { sendError(ws, msg.requestId, '会话不存在'); break }
      await acpHost.setConfig(session.agent_id, sessionId, configId, value)
      sendResult(ws, msg.requestId, { configId, value })
      break
    }

    case 'session.fork': {
      const sessionId = msg.sessionId as string
      const source = sessionStore.get(sessionId)
      if (!source) { sendError(ws, msg.requestId, '会话不存在'); break }
      const forked = sessionStore.create({ agentId: source.agent_id, taskId: source.task_id ?? undefined })
      try {
        const acpSessionId = await acpHost.forkSession(source.agent_id, sessionId, forked.id)
        sessionStore.updateAcpSessionId(forked.id, acpSessionId)
        state.subscriptions.add(forked.id)
        sendResult(ws, msg.requestId, sessionStore.get(forked.id))
      } catch (err) {
        sessionStore.updateStatus(forked.id, 'closed')
        sendError(ws, msg.requestId, err instanceof Error ? err.message : 'fork 会话失败')
      }
      break
    }

    case 'permission.respond': {
      const sessionId = msg.sessionId as string
      const ok = acpHost.resolvePermission(sessionId, msg.permissionRequestId as string, msg.optionId as string | undefined, msg.cancelled as boolean | undefined)
      if (!ok) { sendError(ws, msg.requestId, '权限请求已失效'); break }
      const session = sessionStore.get(sessionId)
      const stored = eventStore.append(sessionId, {
        type: 'permission.result',
        agentId: session?.agent_id,
        messageId: msg.permissionRequestId as string,
        role: 'system',
        payload: { requestId: msg.permissionRequestId, optionId: msg.optionId, cancelled: msg.cancelled === true },
      })
      events.emit('session:event', { sessionId, agentId: session?.agent_id, event: stored })
      sendResult(ws, msg.requestId, { ok: true })
      break
    }

    case 'elicitation.respond': {
      const sessionId = msg.sessionId as string
      const ok = acpHost.resolveElicitation(sessionId, msg.elicitationRequestId as string, msg.action as 'accept' | 'decline' | 'cancel', msg.content as Record<string, string | number | boolean | string[]> | undefined)
      if (!ok) { sendError(ws, msg.requestId, '提问请求已失效'); break }
      const session = sessionStore.get(sessionId)
      const stored = eventStore.append(sessionId, {
        type: 'elicitation.result',
        agentId: session?.agent_id,
        messageId: msg.elicitationRequestId as string,
        role: 'system',
        payload: { requestId: msg.elicitationRequestId, action: msg.action, content: msg.content },
      })
      events.emit('session:event', { sessionId, agentId: session?.agent_id, event: stored })
      sendResult(ws, msg.requestId, { ok: true })
      break
    }

    case 'decision': {
      const sessionId = msg.sessionId as string
      await sessionManager.sendDecision(sessionId, msg.messageId as string, msg.choice as string)
      break
    }

    case 'session.cancel': {
      const sessionId = msg.sessionId as string
      const session = sessionStore.get(sessionId)
      if (!session) { sendError(ws, msg.requestId, '会话不存在'); break }
      try {
        await acpHost.cancelPrompt(session.agent_id, sessionId)
        events.emit('session:done', { sessionId, agentId: session.agent_id, messageId: `cancel-${Date.now()}` })
        sendResult(ws, msg.requestId, { ok: true })
      } catch (err) {
        sendError(ws, msg.requestId, err instanceof Error ? err.message : '取消失败')
      }
      break
    }
    case 'agents.list':
      sendResult(ws, msg.requestId, agentStore.list())
      break

    case 'agents.create': {
      const runtime = msg.runtime as string
      if (!isSupportedAgentRuntime(runtime)) {
        sendError(ws, msg.requestId, `不支持的 Agent runtime: ${runtime || '空'}。当前仅支持 ${SUPPORTED_AGENT_RUNTIMES.join('|')}；Gemini 尚未接入。`)
        break
      }
      const agent = agentStore.create({ type: msg.agentType as string, name: msg.name as string, runtime })
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

    case 'sessions.events':
      sendResult(ws, msg.requestId, eventStore.list(msg.sessionId as string, { limit: msg.limit as number | undefined, afterSequence: msg.afterSequence as number | undefined }))
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
      const actionConfig = msg.actionConfig as { title: string; description?: string; assignAgentId?: string; assign_agent_id?: string }
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
      if (msg.actionConfig !== undefined) {
        const actionConfig = msg.actionConfig as { title: string; description?: string; assignAgentId?: string; assign_agent_id?: string }
        fields.action_config = actionConfig.assign_agent_id !== undefined
          ? { ...actionConfig, assignAgentId: actionConfig.assign_agent_id }
          : actionConfig
      }
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

    // ── Projects ──

    case 'projects.list':
      sendResult(ws, msg.requestId, projectStore.list())
      break

    case 'projects.create': {
      const project = projectStore.create({
        name: msg.name as string,
        workDir: msg.workDir as string,
        description: msg.description as string | undefined,
      })
      sendResult(ws, msg.requestId, project)
      break
    }

    case 'projects.update': {
      const fields: Record<string, unknown> = {}
      if (msg.name !== undefined) fields.name = msg.name
      if (msg.workDir !== undefined) fields.work_dir = msg.workDir
      if (msg.description !== undefined) fields.description = msg.description
      const updated = projectStore.update(msg.projectId as string, fields as never)
      sendResult(ws, msg.requestId, updated)
      break
    }

    case 'projects.delete':
      projectStore.delete(msg.projectId as string)
      sendResult(ws, msg.requestId, { deleted: true })
      break

    // ── Agent Templates ──

    case 'templates.list':
      sendResult(ws, msg.requestId, templateStore.list())
      break

    case 'templates.get':
      sendResult(ws, msg.requestId, templateStore.get(msg.templateId as string))
      break

    case 'templates.create': {
      const tpl = templateStore.create({
        name: msg.name as string,
        type: msg.agentType as string,
        runtime: msg.runtime as string | undefined,
        icon: msg.icon as string | undefined,
        systemPrompt: msg.systemPrompt as string | undefined,
        description: msg.description as string | undefined,
        skills: msg.skills as string[] | undefined,
      })
      sendResult(ws, msg.requestId, tpl)
      break
    }

    case 'templates.update': {
      const fields: Record<string, unknown> = {}
      if (msg.name !== undefined) fields.name = msg.name
      if (msg.agentType !== undefined) fields.type = msg.agentType
      if (msg.runtime !== undefined) fields.runtime = msg.runtime
      if (msg.icon !== undefined) fields.icon = msg.icon
      if (msg.systemPrompt !== undefined) fields.systemPrompt = msg.systemPrompt
      if (msg.description !== undefined) fields.description = msg.description
      if (msg.skills !== undefined) fields.skills = msg.skills
      const updated = templateStore.update(msg.templateId as string, fields as never)
      sendResult(ws, msg.requestId, updated)
      break
    }

    case 'templates.delete':
      templateStore.delete(msg.templateId as string)
      sendResult(ws, msg.requestId, { deleted: true })
      break

    // ── Tools ──

    case 'tools.list': {
      const tools = toolStore.list()
      const bindings = toolBindingStore.list()
      sendResult(ws, msg.requestId, { tools, bindings })
      break
    }

    case 'tools.get': {
      const tool = toolStore.get(msg.toolId as string)
      if (!tool) { sendError(ws, msg.requestId, '工具不存在'); break }
      const bindings = toolBindingStore.list(tool.id)
      sendResult(ws, msg.requestId, { tool, bindings })
      break
    }

    case 'tools.create': {
      try {
        const tool = toolStore.create({
          name: msg.name as string,
          displayName: msg.displayName as string,
          description: msg.description as string,
          category: msg.category as 'browser' | 'filesystem' | 'network' | 'automation' | 'code' | 'data' | 'custom',
          type: msg.toolType as 'builtin' | 'mcp' | 'script',
          config: msg.config as ToolConfig,
          inputSchema: msg.inputSchema as object | undefined,
          permissions: msg.permissions as { requiresApproval: boolean; maxExecutionTime: number; networkAccess: boolean } | undefined,
        })
        if (msg.defaultScope) {
          toolBindingStore.set(tool.id, msg.defaultScope as 'global' | 'project' | 'agent', msg.targetId as string ?? null)
        }
        sendResult(ws, msg.requestId, tool)
      } catch (e) {
        sendError(ws, msg.requestId, `创建工具失败: ${(e as Error).message}`)
      }
      break
    }

    case 'tools.update': {
      const updated = toolStore.update(msg.toolId as string, {
        displayName: msg.displayName as string | undefined,
        description: msg.description as string | undefined,
        category: msg.category as 'browser' | 'filesystem' | 'network' | 'automation' | 'code' | 'data' | 'custom' | undefined,
        type: msg.toolType as 'builtin' | 'mcp' | 'script' | undefined,
        config: msg.config as ToolConfig | undefined,
        inputSchema: msg.inputSchema as object | undefined,
        permissions: msg.permissions as { requiresApproval: boolean; maxExecutionTime: number; networkAccess: boolean } | undefined,
      })
      if (!updated) { sendError(ws, msg.requestId, '工具不存在'); break }
      sendResult(ws, msg.requestId, updated)
      break
    }

    case 'tools.toggle': {
      toolStore.toggle(msg.toolId as string, msg.enabled as boolean)
      sendResult(ws, msg.requestId, { ok: true })
      break
    }

    case 'tools.delete': {
      const tool = toolStore.get(msg.toolId as string)
      if (!tool) { sendError(ws, msg.requestId, '工具不存在'); break }
      if (tool.is_builtin) { sendError(ws, msg.requestId, '不能删除内置工具'); break }
      toolStore.delete(msg.toolId as string)
      sendResult(ws, msg.requestId, { ok: true })
      break
    }

    case 'tool-bindings.set': {
      const binding = toolBindingStore.set(
        msg.toolId as string,
        msg.scope as 'global' | 'project' | 'agent',
        msg.targetId as string ?? null,
        msg.configOverride as Record<string, unknown> | undefined,
      )
      sendResult(ws, msg.requestId, binding)
      break
    }

    case 'tool-bindings.remove': {
      toolBindingStore.remove(msg.toolId as string, msg.scope as 'global' | 'project' | 'agent', msg.targetId as string ?? null)
      sendResult(ws, msg.requestId, { ok: true })
      break
    }

    // ── File System ──

    case 'fs.list': {
      const projectId = msg.projectId as string
      const project = projectStore.get(projectId)
      if (!project) { sendError(ws, msg.requestId, '项目不存在'); break }
      const entries = msg.dirPath
        ? expandDirectory(project.work_dir, msg.dirPath as string)
        : listDirectory(project.work_dir)
      sendResult(ws, msg.requestId, entries)
      break
    }

    case 'fs.read': {
      const projectId = msg.projectId as string
      const project = projectStore.get(projectId)
      if (!project) { sendError(ws, msg.requestId, '项目不存在'); break }
      const fileContent = readFile(project.work_dir, msg.filePath as string)
      if (!fileContent) { sendError(ws, msg.requestId, '文件不存在或无法读取'); break }
      sendResult(ws, msg.requestId, fileContent)
      break
    }

    // ── Model Providers ──

    case 'models.list': {
      sendResult(ws, msg.requestId, modelProviderStore.list())
      break
    }

    case 'models.create': {
      try {
        const provider = modelProviderStore.create({
          name: msg.name as string,
          displayName: msg.displayName as string,
          protocol: msg.protocol as 'openai' | 'claude',
          baseUrl: msg.baseUrl as string,
          apiKey: msg.apiKey as string,
          models: msg.models as { id: string; name: string; isDefault?: boolean }[] | undefined,
          isDefault: msg.isDefault as boolean | undefined,
        })
        sendResult(ws, msg.requestId, provider)
      } catch (e) {
        sendError(ws, msg.requestId, `创建失败: ${(e as Error).message}`)
      }
      break
    }

    case 'models.update': {
      const updated = modelProviderStore.update(msg.providerId as string, {
        displayName: msg.displayName as string | undefined,
        protocol: msg.protocol as 'openai' | 'claude' | undefined,
        baseUrl: msg.baseUrl as string | undefined,
        apiKey: msg.apiKey as string | undefined,
        models: msg.models as { id: string; name: string; isDefault?: boolean }[] | undefined,
        isDefault: msg.isDefault as boolean | undefined,
      })
      if (!updated) { sendError(ws, msg.requestId, '供应商不存在'); break }
      sendResult(ws, msg.requestId, updated)
      break
    }

    case 'models.toggle': {
      modelProviderStore.toggle(msg.providerId as string, msg.enabled as boolean)
      sendResult(ws, msg.requestId, { ok: true })
      break
    }

    case 'models.delete': {
      modelProviderStore.delete(msg.providerId as string)
      sendResult(ws, msg.requestId, { ok: true })
      break
    }

    case 'models.setDefault': {
      modelProviderStore.setDefault(msg.providerId as string)
      sendResult(ws, msg.requestId, { ok: true })
      break
    }

    case 'models.test': {
      try {
        const provider = modelProviderStore.get(msg.providerId as string)
        if (!provider) { sendError(ws, msg.requestId, '供应商不存在'); break }
        const protocol = provider.protocol
        const baseUrl = provider.base_url.replace(/\/$/, '')
        const apiKey = provider.api_key

        if (protocol === 'openai') {
          const resp = await fetch(`${baseUrl}/v1/models`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10_000),
          })
          if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text().then(t => t.slice(0, 200))}`)
          const data = await resp.json() as { data?: { id: string }[] }
          sendResult(ws, msg.requestId, { ok: true, models: data.data?.map(m => m.id) ?? [] })
        } else if (protocol === 'claude') {
          const resp = await fetch(`${baseUrl}/v1/models`, {
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
            signal: AbortSignal.timeout(10_000),
          })
          if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text().then(t => t.slice(0, 200))}`)
          const data = await resp.json() as { data?: { id: string }[] }
          sendResult(ws, msg.requestId, { ok: true, models: data.data?.map(m => m.id) ?? [] })
        } else {
          sendError(ws, msg.requestId, `不支持的协议: ${protocol}`)
        }
      } catch (e) {
        sendResult(ws, msg.requestId, { ok: false, error: (e as Error).message })
      }
      break
    }

    // ── Skills ──

    case 'skills.list': {
      const skills = skillStore.list()
      const skillBindings = skillBindingStore.list()
      sendResult(ws, msg.requestId, { skills, bindings: skillBindings })
      break
    }

    case 'skills.get': {
      const skill = skillStore.get(msg.skillId as string)
      if (!skill) { sendError(ws, msg.requestId, '技能不存在'); break }
      const skillBinds = skillBindingStore.list(skill.id)
      sendResult(ws, msg.requestId, { skill, bindings: skillBinds })
      break
    }

    case 'skills.create': {
      try {
        const skill = skillStore.create({
          name: msg.name as string,
          displayName: msg.displayName as string,
          description: msg.description as string | undefined,
          type: msg.skillType as 'prompt' | 'file' | 'mcp' | undefined,
          content: msg.content as string,
          category: msg.category as string | undefined,
        })
        if (msg.defaultScope) {
          skillBindingStore.set(skill.id, msg.defaultScope as 'global' | 'project' | 'agent', msg.targetId as string ?? null)
        }
        sendResult(ws, msg.requestId, skill)
      } catch (e) {
        sendError(ws, msg.requestId, `创建技能失败: ${(e as Error).message}`)
      }
      break
    }

    case 'skills.update': {
      const updatedSkill = skillStore.update(msg.skillId as string, {
        displayName: msg.displayName as string | undefined,
        description: msg.description as string | undefined,
        type: msg.skillType as 'prompt' | 'file' | 'mcp' | undefined,
        content: msg.content as string | undefined,
        category: msg.category as string | undefined,
      })
      if (!updatedSkill) { sendError(ws, msg.requestId, '技能不存在'); break }
      sendResult(ws, msg.requestId, updatedSkill)
      break
    }

    case 'skills.toggle': {
      skillStore.toggle(msg.skillId as string, msg.enabled as boolean)
      sendResult(ws, msg.requestId, { ok: true })
      break
    }

    case 'skills.delete': {
      const targetSkill = skillStore.get(msg.skillId as string)
      if (!targetSkill) { sendError(ws, msg.requestId, '技能不存在'); break }
      if (targetSkill.is_builtin) { sendError(ws, msg.requestId, '不能删除内置技能'); break }
      skillStore.delete(msg.skillId as string)
      sendResult(ws, msg.requestId, { ok: true })
      break
    }

    case 'skill-bindings.set': {
      const sb = skillBindingStore.set(
        msg.skillId as string,
        msg.scope as 'global' | 'project' | 'agent',
        msg.targetId as string ?? null,
      )
      sendResult(ws, msg.requestId, sb)
      break
    }

    case 'skill-bindings.remove': {
      skillBindingStore.remove(msg.skillId as string, msg.scope as string, msg.targetId as string ?? null)
      sendResult(ws, msg.requestId, { ok: true })
      break
    }

    default:
      sendError(ws, msg.requestId, `未知消息类型: ${msg.type}`)
  }
}
