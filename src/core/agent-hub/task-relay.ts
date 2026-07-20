import { randomUUID } from 'node:crypto'
import { events } from '../events.js'
import { sessionManager } from '../sessions.js'
import { messageStore } from '../../store/sessions.js'
import { agentHubConnectionStore } from '../../store/agent-hub-connections.js'
import { hubClient, type SearchAgentResult } from './hub-client.js'
import type { SseClient, TaskEventData, ResultEventData } from './sse-client.js'
import type { AgentHubConfig } from './config.js'
import type { SessionDoneData } from '../../types/ws-protocol.js'
import { createChildLogger } from '../logger.js'

const log = createChildLogger('agent-hub:relay')

export interface OutboundTask {
  hubTaskId: string
  targetHubAgentId: string
  targetName: string
  message: string
  contextId: string
  sentAt: number
}

export interface InboundTask {
  hubTaskId: string
  sourceHubAgentId: string
  sourceName?: string
  pushUrl: string
  pushToken: string
  localSessionId: string
  contextId: string
  receivedAt: number
}

export interface HubConnection {
  sessionId: string
  agentId: string
  projectId?: string | null
  hubUrl: string
  providerToken: string
  callerToken: string
  internalToken: string
  registrationId: string
  hubAgentId: string
  machineId: string
  sseClient: SseClient
  outboundTasks: Map<string, OutboundTask>
  inboundTasks: Map<string, InboundTask>
  contextSessionMap: Map<string, string>
  doneListeners: Map<string, (data: SessionDoneData) => void>
  agentCache: Map<string, SearchAgentResult>
}

export function formatInboundPrompt(message: TaskEventData['message'], task: InboundTask): string {
  const textParts = (message?.parts || [])
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text as string)
  const text = textParts.join('\n') || '(无内容)'
  const source = task.sourceName || task.sourceHubAgentId
  const protocolUrl = process.env.AGENT_HUB_PROTOCOL_DOC_URL || ''
  return `[Agent Hub 请求]\n来自:${source}\n\n${text}\n\n---\n直接输出结果即可,系统自动回调。不要用 agent_hub.send 回发。规范:${protocolUrl}`
}

export function formatOutboundPrompt(task: OutboundTask, resultText: string): string {
  const sourceName = task.targetName || task.targetHubAgentId
  const text = resultText || '(无结果内容)'
  const protocolUrl = process.env.AGENT_HUB_PROTOCOL_DOC_URL || ''
  return `[Agent Hub 回复]\n来自:${sourceName}\n\n${text}\n\n---\n如需继续对话对方,可用 agent_hub.send。规范:${protocolUrl}`
}

export function extractResultText(task: ResultEventData['task']): string {
  const message = task?.status?.message
  if (!message) return '(无结果内容)'
  const parts = message.parts || []
  const textParts = parts
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text as string)
  return textParts.join('\n') || '(无结果内容)'
}

function readLatestAgentMessage(sessionId: string): string | undefined {
  const msgs = messageStore.list(sessionId, { limit: 100 })
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const msg = msgs[i]
    if (msg.role === 'agent') {
      const content = msg.content
      if (typeof content === 'string') return content
    }
  }
  return undefined
}

async function resolveAgentName(conn: HubConnection, hubAgentId: string): Promise<string | undefined> {
  const cached = conn.agentCache.get(hubAgentId)
  if (cached) return cached.name
  try {
    const agents = await hubClient.search(conn.hubUrl, conn.callerToken, {})
    for (const a of agents) {
      conn.agentCache.set(a.hubAgentId, a)
    }
    return agents.find((a) => a.hubAgentId === hubAgentId)?.name
  } catch (e) {
    log.warn({ err: e, hubAgentId }, '查找 source Agent name 失败')
    return undefined
  }
}

export async function handleInboundTask(conn: HubConnection, data: TaskEventData): Promise<void> {
  const message = data.message || {}
  const metadata = (data.metadata ?? {}) as Record<string, unknown>
  const hubTaskId = String(metadata.hubTaskId || '')
  const sourceHubAgentId = String(metadata.sourceHubAgentId || '')
  const pushConfig = data.configuration?.taskPushNotificationConfig
  const pushUrl = pushConfig?.url
  const pushToken = pushConfig?.authentication?.credentials

  if (!hubTaskId || !pushUrl || !pushToken) {
    log.warn({ hubTaskId, hasPushUrl: !!pushUrl, hasPushToken: !!pushToken }, 'inbound task 缺少必要字段,丢弃')
    return
  }

  const contextId = message.contextId || `ctx-${randomUUID().slice(0, 8)}`
  // inbound task 复用 connect 会话,不新建 session
  const localSessionId = conn.contextSessionMap.get(contextId) ?? conn.sessionId
  conn.contextSessionMap.set(contextId, localSessionId)

  const sourceName = await resolveAgentName(conn, sourceHubAgentId)
  const inboundTask: InboundTask = {
    hubTaskId,
    sourceHubAgentId,
    sourceName,
    pushUrl,
    pushToken,
    localSessionId,
    contextId,
    receivedAt: Date.now(),
  }
  conn.inboundTasks.set(hubTaskId, inboundTask)
  agentHubConnectionStore.updateActivity(conn.sessionId, new Date().toISOString())

  const prompt = formatInboundPrompt(message, inboundTask)

  // doneHandler 必须在 enqueuePrompt 之前注册:
  // enqueuePrompt 内部 await acpHost.prompt 会阻塞到 prompt 完成,
  // session:done 事件在 prompt 完成瞬间 emit,先 enqueue 再注册会错过事件
  const doneHandler = (data: SessionDoneData): void => {
    if (data.sessionId !== localSessionId) return
    events.off('session:done', doneHandler)
    conn.doneListeners.delete(hubTaskId)
    void relayResultBack(conn, inboundTask, data)
  }
  conn.doneListeners.set(hubTaskId, doneHandler)
  events.on('session:done', doneHandler)

  try {
    await sessionManager.enqueuePrompt(localSessionId, prompt)
  } catch (e) {
    log.error({ err: e, sessionId: localSessionId }, 'inbound enqueuePrompt 失败')
    events.off('session:done', doneHandler)
    conn.doneListeners.delete(hubTaskId)
    conn.inboundTasks.delete(hubTaskId)
    // enqueuePrompt 失败也回传 FAILED,避免 Hub 端 task 卡在 SUBMITTED
    const failResult = {
      task: {
        id: hubTaskId,
        contextId,
        status: {
          state: 'TASK_STATE_FAILED',
          timestamp: new Date().toISOString(),
          message: {
            messageId: `msg-${randomUUID().slice(0, 8)}`,
            role: 'ROLE_AGENT',
            parts: [{ type: 'text', text: `本地 enqueuePrompt 失败: ${(e as Error).message}`, mediaType: 'text/plain' }],
          },
        },
        artifacts: [] as unknown[],
      },
    }
    try {
      await hubClient.pushResult(pushUrl, pushToken, failResult)
    } catch (pushErr) {
      log.warn({ err: pushErr, hubTaskId }, 'enqueuePrompt 失败后回传 FAILED 也失败')
    }
  }
}

async function relayResultBack(conn: HubConnection, task: InboundTask, doneData: SessionDoneData): Promise<void> {
  const finalText = readLatestAgentMessage(task.localSessionId)
  const result = {
    task: {
      id: task.hubTaskId,
      contextId: task.contextId,
      status: {
        state: doneData.error ? 'TASK_STATE_FAILED' : 'TASK_STATE_COMPLETED',
        timestamp: new Date().toISOString(),
        message: {
          messageId: `msg-${randomUUID().slice(0, 8)}`,
          role: 'ROLE_AGENT',
          parts: [{ type: 'text', text: finalText || '(empty)', mediaType: 'text/plain' }],
        },
      },
      artifacts: [] as unknown[],
    },
  }

  try {
    await hubClient.pushResult(task.pushUrl, task.pushToken, result)
    conn.inboundTasks.delete(task.hubTaskId)
  } catch (e) {
    log.warn({ err: e, hubTaskId: task.hubTaskId }, '回传结果到 Hub 失败,保留 inboundTask 等下次清理')
  }
}

export async function handleOutboundResult(conn: HubConnection, data: ResultEventData): Promise<void> {
  const { hubTaskId, task } = data
  if (!hubTaskId) return
  const outbound = conn.outboundTasks.get(hubTaskId)
  if (!outbound) return

  const resultText = extractResultText(task)
  const prompt = formatOutboundPrompt(outbound, resultText)
  try {
    await sessionManager.enqueuePrompt(conn.sessionId, prompt)
  } catch (e) {
    log.warn({ err: e, sessionId: conn.sessionId }, 'outbound enqueuePrompt 失败')
  }
  conn.outboundTasks.delete(hubTaskId)
}

export function buildSseHandlers(conn: HubConnection, _config: AgentHubConfig) {
  return {
    onConnected() {
      log.info({ sessionId: conn.sessionId, registrationId: conn.registrationId }, 'SSE 已连接')
    },
    onTask(data: TaskEventData, eventId: string) {
      log.debug({ sessionId: conn.sessionId, eventId }, '收到 inbound task')
      void handleInboundTask(conn, data)
    },
    onResult(data: ResultEventData, eventId: string) {
      log.debug({ sessionId: conn.sessionId, eventId, hubTaskId: data.hubTaskId }, '收到 outbound result')
      void handleOutboundResult(conn, data)
    },
    onError(err: Error) {
      log.warn({ sessionId: conn.sessionId, err: err.message }, 'SSE 错误')
    },
  }
}
