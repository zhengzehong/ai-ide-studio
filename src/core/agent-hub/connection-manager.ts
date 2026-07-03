import { randomUUID } from 'node:crypto'
import { agentStore } from '../../store/agents.js'
import { sessionStore } from '../../store/sessions.js'
import { agentHubConnectionStore, type AgentHubConnectionRow } from '../../store/agent-hub-connections.js'
import { createChildLogger } from '../logger.js'
import { loadAgentHubConfig } from './config.js'
import { getOrCreateMachineId, getMachineLabel } from './machine-id.js'
import { buildHubNaming, type AgentInfo } from './naming.js'
import { hubClient, type RegisterResponse, type SearchAgentResult } from './hub-client.js'
import { SseClient } from './sse-client.js'
import {
  buildSseHandlers,
  type HubConnection,
  type OutboundTask,
} from './task-relay.js'
import { events } from '../events.js'
import type { SessionDoneData } from '../../types/ws-protocol.js'

const log = createChildLogger('agent-hub:manager')

const IDLE_THRESHOLD_MS = 12 * 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000

const connections = new Map<string, HubConnection & { config_defaultScopeKeys: string[] }>()

function toAgentInfo(row: SearchAgentResult): AgentInfo {
  return {
    hubAgentId: row.hubAgentId,
    name: row.name,
    description: row.description || '',
    scopeKeys: row.scopeKeys || [],
    capabilityTags: row.capabilityTags || [],
    a2aBaseUrl: row.a2aBaseUrl || '',
    status: row.status || 'online',
  }
}

async function searchVisibleAgents(
  conn: HubConnection & { config_defaultScopeKeys: string[] },
  scopeKeys?: string[],
  match?: 'any' | 'all',
): Promise<AgentInfo[]> {
  const finalScopeKeys = scopeKeys ?? conn.config_defaultScopeKeys
  const result = await hubClient.search(conn.hubUrl, conn.callerToken, {
    scopeKeys: finalScopeKeys,
    match: match ?? 'any',
  })
  return result.filter((a) => a.hubAgentId !== conn.hubAgentId).map(toAgentInfo)
}

type InternalHubConnection = HubConnection & { config_defaultScopeKeys: string[] }

export const agentHubService = {
  isConnected(sessionId: string): boolean {
    return connections.has(sessionId)
  },

  async connect(sessionId: string, agentId: string, projectId?: string | null): Promise<{
    status: 'connected' | 'already_connected' | 'disabled'
    hubAgentId?: string
    registrationId?: string
    reused?: boolean
    discoveredAgents?: AgentInfo[]
    reason?: string
  }> {
    const config = loadAgentHubConfig()
    if (!config.enabled) {
      return { status: 'disabled', reason: 'Hub 未启用' }
    }

    const existing = connections.get(sessionId)
    if (existing) {
      const discovered = await searchVisibleAgents(existing, config.defaultScopeKeys)
      return {
        status: 'already_connected',
        hubAgentId: existing.hubAgentId,
        registrationId: existing.registrationId,
        discoveredAgents: discovered,
      }
    }

    const agent = agentStore.get(agentId)
    if (!agent) throw new Error(`Agent 不存在: ${agentId}`)

    const machineId = await getOrCreateMachineId()
    const naming = buildHubNaming({
      agentId,
      agentName: agent.name,
      agentDescription: agent.system_prompt,
      machineId,
      machineLabel: getMachineLabel(),
      sessionId,
      projectId: projectId ?? agent.project_id ?? null,
    })

    let registration: RegisterResponse
    try {
      registration = await hubClient.register(config.hubUrl, config.providerToken, {
        provider: 'ai-ide-studio',
        instanceId: naming.instanceId,
        transportMode: 'sse',
        agents: [
          {
            localAgentId: agentId,
            name: naming.name,
            description: naming.description,
            scopeKeys: naming.scopeKeys,
          },
        ],
      })
    } catch (e) {
      const err = e as { message?: string; status?: number }
      throw new Error(`注册 Hub 失败: ${err.message || '未知错误'}`, { cause: e })
    }

    const registered = registration.agents.find((a) => a.localAgentId === agentId)
    if (!registered) {
      throw new Error('Hub 未返回对应 localAgentId 的 hubAgentId')
    }

    const tempConn: Partial<InternalHubConnection> = {
      sessionId,
      agentId,
      projectId: projectId ?? agent.project_id ?? null,
      hubUrl: config.hubUrl,
      providerToken: config.providerToken,
      callerToken: config.callerToken,
      internalToken: config.internalToken,
      registrationId: registration.registrationId,
      hubAgentId: registered.hubAgentId,
      machineId,
      outboundTasks: new Map(),
      inboundTasks: new Map(),
      contextSessionMap: new Map(),
      doneListeners: new Map(),
      agentCache: new Map(),
      config_defaultScopeKeys: config.defaultScopeKeys,
    }

    const sseClient = new SseClient(
      config.hubUrl,
      registration.registrationId,
      config.providerToken,
      buildSseHandlers(tempConn as HubConnection, config),
    )
    tempConn.sseClient = sseClient
    const conn = tempConn as InternalHubConnection
    connections.set(sessionId, conn)
    sseClient.start()

    const nowIso = new Date().toISOString()
    agentHubConnectionStore.upsert({
      session_id: sessionId,
      agent_id: agentId,
      project_id: projectId ?? agent.project_id ?? null,
      registration_id: conn.registrationId,
      hub_url: conn.hubUrl,
      hub_agent_id: conn.hubAgentId,
      machine_id: machineId,
      connected_at: nowIso,
      last_activity_at: nowIso,
    })

    let discoveredAgents: AgentInfo[] = []
    try {
      discoveredAgents = await searchVisibleAgents(conn, config.defaultScopeKeys)
    } catch (e) {
      log.warn({ err: e, sessionId }, '初始 search 失败,继续返回 connect 成功')
    }

    log.info(
      { sessionId, agentId, hubAgentId: conn.hubAgentId, registrationId: conn.registrationId, reused: registration.reused },
      'Hub 已连接',
    )

    return {
      status: 'connected',
      hubAgentId: conn.hubAgentId,
      registrationId: conn.registrationId,
      reused: registration.reused === true,
      discoveredAgents,
    }
  },

  async disconnect(sessionId: string): Promise<{ status: 'disconnected' | 'not_connected' }> {
    const conn = connections.get(sessionId)
    if (!conn) return { status: 'not_connected' }
    await this.disconnectBySession(sessionId)
    return { status: 'disconnected' }
  },

  async disconnectBySession(sessionId: string): Promise<void> {
    const conn = connections.get(sessionId)
    if (!conn) return

    for (const [, handler] of conn.doneListeners) {
      events.off('session:done', handler as (data: SessionDoneData) => void)
    }
    conn.doneListeners.clear()

    await hubClient.unregister(conn.hubUrl, conn.providerToken, conn.registrationId)

    conn.sseClient.stop()
    conn.outboundTasks.clear()
    conn.inboundTasks.clear()
    conn.contextSessionMap.clear()
    connections.delete(sessionId)
    agentHubConnectionStore.delete(sessionId)
    log.info({ sessionId, registrationId: conn.registrationId }, 'Hub 连接已断开')
  },

  async list(
    sessionId: string,
    scopeKeys?: string[],
    match?: 'any' | 'all',
  ): Promise<{ status: 'ok'; agents: AgentInfo[] } | { status: 'not_connected'; reason: string }> {
    const conn = connections.get(sessionId)
    if (!conn) return { status: 'not_connected', reason: '请先 agent_hub.connect' }
    const agents = await searchVisibleAgents(conn, scopeKeys, match)
    return { status: 'ok', agents }
  },

  async send(
    sessionId: string,
    targetHubAgentId: string,
    message: string,
    contextId?: string,
  ): Promise<{ hubTaskId: string; status: string }> {
    const conn = connections.get(sessionId)
    if (!conn) throw new Error('未连接 Hub,请先 agent_hub.connect')

    const messageId = `msg-${randomUUID().slice(0, 8)}`
    const finalContextId = contextId || `ctx-${randomUUID().slice(0, 8)}`

    let targetName = targetHubAgentId
    try {
      const agents = await hubClient.search(conn.hubUrl, conn.callerToken, {})
      for (const a of agents) conn.agentCache.set(a.hubAgentId, a)
      const found = agents.find((a) => a.hubAgentId === targetHubAgentId)
      if (found) targetName = found.name
    } catch (e) {
      log.warn({ err: e, targetHubAgentId }, '查找目标 Agent 名称失败,用 hubAgentId 替代')
    }

    const payload = {
      message: {
        messageId,
        contextId: finalContextId,
        role: 'user',
        parts: [{ type: 'text', text: message }],
      },
      metadata: {
        callerHubAgentId: conn.hubAgentId,
        callerTransportMode: 'sse',
      },
    }

    const response = await hubClient.sendMessage(conn.hubUrl, conn.callerToken, targetHubAgentId, payload)
    const hubTaskId = response.task.id

    const outbound: OutboundTask = {
      hubTaskId,
      targetHubAgentId,
      targetName,
      message,
      contextId: finalContextId,
      sentAt: Date.now(),
    }
    conn.outboundTasks.set(hubTaskId, outbound)
    agentHubConnectionStore.updateActivity(sessionId, new Date().toISOString())

    log.info({ sessionId, hubTaskId, targetHubAgentId, contextId: finalContextId }, '已发送 Hub 消息')

    return { hubTaskId, status: response.task.status?.state || 'TASK_STATE_SUBMITTED' }
  },

  async uploadFile(
    sessionId: string,
    filePath: string,
    purpose?: string,
  ): Promise<{ fileId: string; filename: string; mediaType: string; size: number; url: string }> {
    const conn = connections.get(sessionId)
    if (!conn) throw new Error('未连接 Hub,请先 agent_hub.connect')
    return hubClient.uploadFile(conn.hubUrl, conn.providerToken, filePath, purpose)
  },

  async reconnectAll(): Promise<void> {
    const rows = agentHubConnectionStore.list()
    if (rows.length === 0) return
    log.info({ count: rows.length }, '启动时恢复 Hub 连接')
    await Promise.all(rows.map((row) => reconnectRow(row)))
  },

  async cleanupStale(): Promise<void> {
    const threshold = new Date(Date.now() - IDLE_THRESHOLD_MS).toISOString()
    const stale = agentHubConnectionStore.listStale(threshold)
    if (stale.length === 0) return
    log.info({ count: stale.length, threshold }, '清理 12h 无活动 Hub 连接')
    const config = loadAgentHubConfig()
    for (const row of stale) {
      try {
        await hubClient.unregister(row.hub_url, config.providerToken, row.registration_id)
      } catch (e) {
        log.warn({ err: e, sessionId: row.session_id }, '清理注销失败,继续删 DB')
      }
      agentHubConnectionStore.delete(row.session_id)
      const conn = connections.get(row.session_id)
      if (conn) {
        conn.sseClient.stop()
        connections.delete(row.session_id)
      }
    }
  },

  startCleanupTimer(): NodeJS.Timeout {
    return setInterval(() => {
      void this.cleanupStale()
    }, CLEANUP_INTERVAL_MS)
  },

  _resetForTest(): void {
    for (const [, conn] of connections) {
      conn.sseClient.stop()
    }
    connections.clear()
  },
}

async function reconnectRow(row: AgentHubConnectionRow): Promise<void> {
  const session = sessionStore.get(row.session_id)
  if (!session || session.status !== 'active' || session.deleted_at) {
    log.info({ sessionId: row.session_id, reason: 'session 不活跃' }, '启动恢复:注销残留')
    const config = loadAgentHubConfig()
    try {
      await hubClient.unregister(row.hub_url, config.providerToken, row.registration_id)
    } catch (e) {
      log.warn({ err: e, sessionId: row.session_id }, '启动注销失败,继续删 DB')
    }
    agentHubConnectionStore.delete(row.session_id)
    return
  }
  try {
    await agentHubService.connect(row.session_id, row.agent_id, row.project_id)
    log.info({ sessionId: row.session_id }, '启动恢复:重连成功')
  } catch (e) {
    log.warn({ err: e, sessionId: row.session_id }, '启动恢复:重连失败,保留 DB 记录等下次')
  }
}
