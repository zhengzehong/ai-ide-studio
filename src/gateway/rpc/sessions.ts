import { acpHost } from '../../acp/host.js'
import { events } from '../../core/events.js'
import {
  listLocalSessionCandidates,
  localSessionCwdWarning,
  parseLocalSessionFile,
  validateLocalSessionRuntime,
  type ImportableLocalRuntime,
  type LocalSessionCandidate,
} from '../../core/local-session-import.js'
import { createChildLogger } from '../../core/logger.js'
import { sessionManager } from '../../core/sessions.js'
import { agentStore } from '../../store/agents.js'
import { globalAssistantStore } from '../../store/global-assistant.js'
import { projectStore } from '../../store/projects.js'
import { eventStore, messageStore, sessionStore } from '../../store/sessions.js'
import { parseToolCallsJson, selectToolCallDetail, summarizeToolCalls } from '../../store/tool-call-history.js'
import { buildFileChangesFromToolCalls } from '../../store/file-changes.js'
import { turnProcessItemStore } from '../../store/turn-process-items.js'
import type { FileChangeDetailData } from '../../types/ws-protocol.js'
import type { AgentConnection } from '../../acp/host-types.js'
import type { AgentRow } from '../../store/agents.js'
import type { RpcHandlerMap } from './types.js'

const log = createChildLogger('rpc-sessions')

function resolveSessionProjectContext(sessionId: string): { projectId?: string; cwd?: string } {
  const session = sessionStore.get(sessionId)
  if (!session) return {}
  const globalWorkspaceDir = globalAssistantStore.workspaceForSession(sessionId)
  if (globalWorkspaceDir) return { projectId: session.project_id ?? undefined, cwd: globalWorkspaceDir }
  const project = session.project_id ? projectStore.get(session.project_id) : undefined
  return { projectId: session.project_id ?? undefined, cwd: project?.work_dir }
}

function resolveImportRuntime(runtime: string): ImportableLocalRuntime {
  if (runtime === 'codex' || runtime === 'claude') return runtime
  throw new Error('仅支持导入 Codex 或 Claude Code 本地会话')
}

function requireProjectAgent(agentId: string, projectId?: string): AgentRow {
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error('Agent 不存在')
  if (projectId && agent.project_id !== projectId) throw new Error('Agent 不属于当前项目')
  return agent
}

function candidateFromRpcInput(msg: Record<string, unknown>, fallbackRuntime: ImportableLocalRuntime): LocalSessionCandidate {
  if (typeof msg.jsonlPath === 'string' && msg.jsonlPath.trim()) {
    return parseLocalSessionFile(msg.jsonlPath.trim())
  }
  if (typeof msg.externalSessionId !== 'string' || !msg.externalSessionId.trim()) {
    throw new Error('请提供 JSONL 文件路径或本地会话 id')
  }
  const runtime = typeof msg.runtime === 'string' && msg.runtime.trim()
    ? resolveImportRuntime(msg.runtime)
    : fallbackRuntime
  return {
    runtime,
    sessionId: msg.externalSessionId.trim(),
    path: typeof msg.sourcePath === 'string' ? msg.sourcePath : '',
    label: typeof msg.title === 'string' && msg.title.trim() ? msg.title.trim() : `${runtime} ${msg.externalSessionId.slice(0, 8)}`,
    updatedAt: new Date().toISOString(),
    cwd: typeof msg.cwd === 'string' && msg.cwd.trim() ? msg.cwd.trim() : undefined,
  }
}

async function ensureAcpSession(sessionId: string, emitLifecycle = true): Promise<{ agentId: string }> {
  const session = sessionStore.get(sessionId)
  if (!session) throw new Error('\u4f1a\u8bdd\u4e0d\u5b58\u5728')
  const context = resolveSessionProjectContext(sessionId)
  const acpSessionId = await acpHost.ensureSession(session.agent_id, sessionId, session.acp_session_id, {
    ...context,
    emitLifecycle,
  })
  if (session.acp_session_id !== acpSessionId) sessionStore.updateAcpSessionId(sessionId, acpSessionId)
  return { agentId: session.agent_id }
}

function getSessionMessage(sessionId: string, messageId: string) {
  const message = messageStore.get(messageId)
  if (!message || message.session_id !== sessionId) throw new Error('消息不存在')
  return message
}
function buildProcessFileChanges(messageId: string): FileChangeDetailData | undefined {
  const items = turnProcessItemStore.list(messageId, { includeDetail: true }).filter((item) => item.kind === 'file_change' && item.detail_json)
  if (items.length === 0) return undefined
  const files = new Map<string, FileChangeDetailData['files'][number]>()
  for (const item of items) {
    const detail = parseFileChangeDetail(item.detail_json)
    if (!detail) continue
    for (const file of detail.files) {
      const existing = files.get(file.path)
      if (existing) {
        existing.addedLines += file.addedLines
        existing.deletedLines += file.deletedLines
        existing.segments.push(...file.segments)
        continue
      }
      files.set(file.path, { ...file, segments: [...file.segments] })
    }
  }
  const mergedFiles = Array.from(files.values())
  if (mergedFiles.length === 0) return undefined
  return {
    files: mergedFiles,
    totalAdded: mergedFiles.reduce((sum, file) => sum + file.addedLines, 0),
    totalDeleted: mergedFiles.reduce((sum, file) => sum + file.deletedLines, 0),
  }
}

function parseFileChangeDetail(raw: string | null | undefined): FileChangeDetailData | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as Partial<FileChangeDetailData>
    return Array.isArray(parsed.files)
      ? {
          files: parsed.files as FileChangeDetailData['files'],
          totalAdded: typeof parsed.totalAdded === 'number' ? parsed.totalAdded : 0,
          totalDeleted: typeof parsed.totalDeleted === 'number' ? parsed.totalDeleted : 0,
        }
      : undefined
  } catch {
    return undefined
  }
}

export function forceCancelTimedOutTurn(
  conn: AgentConnection,
  sessionId: string,
  cancelledTurnKey: number | undefined,
): boolean {
  if (cancelledTurnKey === undefined) return false
  const runtimeSession = conn.runtimeSessions.get(sessionId)
  if (!runtimeSession || runtimeSession.activeTurnCount <= 0) return false
  if (runtimeSession.activeTurnKey !== cancelledTurnKey) return false
  const reject = runtimeSession.activeTurnReject
  runtimeSession.activeTurnCount = 0
  runtimeSession.activeTurnKey = undefined
  runtimeSession.activeTurnReject = undefined
  conn.activeTurnCount = Math.max(0, conn.activeTurnCount - 1)
  if (reject) {
    try { reject(new Error('cancel timeout: forcing done after 10s')) } catch { /* noop */ }
  }
  return true
}

export const sessionRpcHandlers: RpcHandlerMap = {
  async 'session.setModel'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const modelId = msg.modelId as string
    const { agentId } = await ensureAcpSession(sessionId, false)
    await acpHost.setModel(agentId, sessionId, modelId)
    sessionStore.updateRuntimePreferences(sessionId, { modelId })
    sendResult({ modelId })
  },

  async 'session.getModels'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const { agentId } = await ensureAcpSession(sessionId, false)
    const caps = acpHost.getSessionCapabilities(agentId, sessionId)
    sendResult({
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
  },

  async 'session.setMode'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const modeId = msg.modeId as string
    const { agentId } = await ensureAcpSession(sessionId, false)
    await acpHost.setMode(agentId, sessionId, modeId)
    sessionStore.updateRuntimePreferences(sessionId, { modeId })
    sendResult({ modeId })
  },

  async 'session.setConfig'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const configId = msg.configId as string
    const value = msg.value as string | boolean
    const { agentId } = await ensureAcpSession(sessionId, false)
    await acpHost.setConfig(agentId, sessionId, configId, value)
    sessionStore.updateRuntimePreferences(sessionId, { config: { [configId]: value } })
    sendResult({ configId, value })
  },

  async 'session.fork'(msg, { state, sendResult }) {
    const sessionId = msg.sessionId as string
    const source = sessionStore.get(sessionId)
    if (!source) throw new Error('会话不存在')
    const forked = sessionStore.create({ agentId: source.agent_id, taskId: source.task_id ?? undefined, projectId: source.project_id ?? undefined })
    try {
      const project = source.project_id ? projectStore.get(source.project_id) : undefined
      const acpSessionId = await acpHost.forkSession(source.agent_id, sessionId, forked.id, {
        projectId: source.project_id ?? undefined,
        cwd: project?.work_dir,
      })
      sessionStore.updateAcpSessionId(forked.id, acpSessionId)
      state.subscriptions.add(forked.id)
      sendResult(sessionStore.get(forked.id))
    } catch (err) {
      sessionStore.updateStatus(forked.id, 'closed')
      throw new Error(err instanceof Error ? err.message : 'fork 会话失败', { cause: err })
    }
  },

  'permission.respond'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const ok = acpHost.resolvePermission(sessionId, msg.permissionRequestId as string, msg.optionId as string | undefined, msg.cancelled as boolean | undefined)
    if (!ok) throw new Error('权限请求已失效')
    const session = sessionStore.get(sessionId)
    const stored = eventStore.append(sessionId, {
      type: 'permission.result',
      agentId: session?.agent_id,
      messageId: msg.permissionRequestId as string,
      role: 'system',
      payload: { requestId: msg.permissionRequestId, optionId: msg.optionId, cancelled: msg.cancelled === true },
    })
    events.emit('session:event', { sessionId, agentId: session?.agent_id, event: stored })
    sendResult({ ok: true })
  },

  'elicitation.respond'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const ok = acpHost.resolveElicitation(sessionId, msg.elicitationRequestId as string, msg.action as 'accept' | 'decline' | 'cancel', msg.content as Record<string, string | number | boolean | string[]> | undefined)
    if (!ok) throw new Error('提问请求已失效')
    const session = sessionStore.get(sessionId)
    const stored = eventStore.append(sessionId, {
      type: 'elicitation.result',
      agentId: session?.agent_id,
      messageId: msg.elicitationRequestId as string,
      role: 'system',
      payload: { requestId: msg.elicitationRequestId, action: msg.action, content: msg.content },
    })
    events.emit('session:event', { sessionId, agentId: session?.agent_id, event: stored })
    sendResult({ ok: true })
  },

  async 'session.cancel'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const session = sessionStore.get(sessionId)
    if (!session) throw new Error('会话不存在')
    const activeConn = acpHost.agents.get(session.agent_id)
    const cancelledTurnKey = activeConn?.runtimeSessions.get(sessionId)?.activeTurnKey
    await acpHost.cancelPrompt(session.agent_id, sessionId)
    sendResult({ ok: true })
    setTimeout(() => {
      const conn = acpHost.agents.get(session.agent_id)
      if (!conn) return
      if (forceCancelTimedOutTurn(conn, sessionId, cancelledTurnKey)) {
        // ACP 10s 未响应 cancelPrompt:sendPromptNow 的 finally 块跑不到(activeTurnReject 已 reject,
        // 但 await acpHost.cancelPrompt 卡住),activePrompts 残留会让会话永久卡"生成中"。
        // 这里显式清,与 sendPromptNow finally 等价,必须在 emit session:done 之前清,
        // 否则 session:done 的 handler 读了 activePrompts 还是非空(虽然当前 handler 不读,未来可能读)。
        sessionManager.forceClearActivePrompt(sessionId)
        log.warn({ sessionId, agentId: session.agent_id, cancelledTurnKey }, 'cancel timeout: forcing done after 10s')
        events.emit('session:done', { sessionId, agentId: session.agent_id, messageId: `cancel-timeout-${Date.now()}`, stopReason: 'cancelled' })
      }
    }, 10_000)
  },

  'sessions.list'(msg, { sendResult }) {
    sendResult(sessionStore.listWithRuntimeState(
      msg.agentId as string | undefined,
      msg.projectId as string | undefined,
      (sessionId) => sessionManager.isPromptActive(sessionId),
    ))
  },

  'sessions.listLocalImportCandidates'(msg, { sendResult }) {
    const agentId = msg.agentId as string
    const projectId = msg.projectId as string | undefined
    const agent = requireProjectAgent(agentId, projectId)
    const runtime = resolveImportRuntime(agent.runtime)
    const project = projectId ? projectStore.get(projectId) : undefined
    if (projectId && !project) throw new Error('项目不存在')
    sendResult(listLocalSessionCandidates({
      runtime,
      cwd: project?.work_dir,
      codexHome: typeof msg.codexHome === 'string' ? msg.codexHome : undefined,
      claudeHome: typeof msg.claudeHome === 'string' ? msg.claudeHome : undefined,
      limit: typeof msg.limit === 'number' ? msg.limit : undefined,
    }))
  },

  async 'sessions.create'(msg, { state, sendResult }) {
    const session = await sessionManager.createSession(msg.agentId as string, msg.taskId as string | undefined, msg.projectId as string | undefined)
    state.subscriptions.add(session.id)
    sendResult(session)
  },

  'sessions.importLocal'(msg, { state, sendResult }) {
    const agentId = msg.agentId as string
    const projectId = msg.projectId as string | undefined
    const agent = requireProjectAgent(agentId, projectId)
    const runtime = resolveImportRuntime(agent.runtime)
    const project = projectId ? projectStore.get(projectId) : undefined
    if (projectId && !project) throw new Error('项目不存在')
    const candidate = candidateFromRpcInput(msg, runtime)
    validateLocalSessionRuntime(candidate, runtime)
    const warning = localSessionCwdWarning(candidate, project?.work_dir) ?? null
    const session = sessionStore.create({ agentId, projectId, acpSessionId: candidate.sessionId })
    sessionStore.updateTitleIfEmpty(session.id, `导入本地会话 ${candidate.sessionId.slice(0, 8)}`)
    const imported = sessionStore.get(session.id) ?? session
    state.subscriptions.add(imported.id)
    log.info(
      {
        sessionId: imported.id,
        agentId,
        projectId,
        runtime,
        acpSessionId: candidate.sessionId,
        sourcePath: candidate.path || undefined,
        hasWarning: !!warning,
      },
      'local ACP session imported',
    )
    sendResult({ session: imported, warning, candidate })
  },

  async 'sessions.copy'(msg, { state, sendResult }) {
    const session = await sessionManager.copySession(msg.sessionId as string)
    state.subscriptions.add(session.id)
    sendResult(session)
  },

  'sessions.rename'(msg, { sendResult }) {
    sendResult(sessionManager.renameSession(msg.sessionId as string, msg.title as string))
  },

  async 'sessions.close'(msg, { sendResult }) {
    await sessionManager.closeSession(msg.sessionId as string)
    sendResult(sessionStore.get(msg.sessionId as string))
  },

  'sessions.archive'(msg, { sendResult }) {
    sendResult(sessionManager.archiveSession(msg.sessionId as string))
  },

  'sessions.reorder'(msg, { sendResult }) {
    sendResult(sessionStore.reorder(msg.projectId as string, msg.agentId as string, msg.sessionIds as string[]))
  },

  async 'sessions.delete'(msg, { state, sendResult }) {
    await sessionManager.deleteSession(msg.sessionId as string)
    state.subscriptions.delete(msg.sessionId as string)
    sendResult({ deleted: true })
  },

  'sessions.messages'(msg, { sendResult }) {
    sendResult(messageStore.list(msg.sessionId as string, {
      limit: msg.limit as number | undefined,
      before: msg.before as string | undefined,
      includeToolCalls: msg.includeToolCalls as boolean | undefined,
      includeLatestToolCalls: msg.includeLatestToolCalls as boolean | undefined,
    }))
  },

  'sessions.messageToolCalls'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const message = getSessionMessage(sessionId, msg.messageId as string)
    sendResult(summarizeToolCalls(parseToolCallsJson(message.tool_calls_json)))
  },

  'sessions.messageToolCallDetail'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const message = getSessionMessage(sessionId, msg.messageId as string)
    const detail = selectToolCallDetail(parseToolCallsJson(message.tool_calls_json), msg.toolCallId as string)
    if (!detail) throw new Error('工具调用不存在')
    sendResult(detail)
  },

  'sessions.messageFileChanges'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const message = getSessionMessage(sessionId, msg.messageId as string)
    const processChanges = buildProcessFileChanges(message.id)
    if (processChanges) {
      sendResult(processChanges)
      return
    }
    sendResult(buildFileChangesFromToolCalls(parseToolCallsJson(message.tool_calls_json)))
  },

  'sessions.messageProcess'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const message = getSessionMessage(sessionId, msg.messageId as string)
    if (message.role !== 'agent') {
      sendResult([])
      return
    }
    sendResult(turnProcessItemStore.list(message.id))
  },

  'sessions.processItemDetail'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const message = getSessionMessage(sessionId, msg.messageId as string)
    const detail = turnProcessItemStore.detail(message.id, msg.itemId as string)
    if (!detail) throw new Error('执行过程详情不存在')
    sendResult(detail)
  },


  'sessions.messageEvents'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const message = getSessionMessage(sessionId, msg.messageId as string)
    if (message.role !== 'agent') {
      sendResult([])
      return
    }
    sendResult(eventStore.listByMessage(sessionId, message.id))
  },

  'sessions.events'(msg, { sendResult }) {
    sendResult(eventStore.list(msg.sessionId as string, { limit: msg.limit as number | undefined, afterSequence: msg.afterSequence as number | undefined }))
  },

  'sessions.markRead'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const session = sessionStore.get(sessionId)
    if (!session) throw new Error('会话不存在')
    const lastReadAt = sessionStore.markRead(sessionId)
    events.emit('session:changed', {
      sessionId,
      data: { lastReadAt },
    })
    log.info({ sessionId, lastReadAt }, 'session marked as read')
    sendResult({ sessionId, lastReadAt })
  },
}
