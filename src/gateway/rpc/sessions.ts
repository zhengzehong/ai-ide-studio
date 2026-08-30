import {
  listLocalSessionCandidates,
  localSessionCwdWarning,
  parseLocalSessionFile,
  validateLocalSessionRuntime,
  type ImportableLocalRuntime,
  type LocalSessionCandidate,
} from '../../core/local-session-import.js'
import { createChildLogger } from '../../core/logger.js'
import {
  configureSessionRuntime,
  getSessionRuntimeCapabilities,
} from '../../core/session-runtime-control.js'
import { sessionManager } from '../../core/sessions.js'
import { agentStore } from '../../store/agents.js'
import { projectStore } from '../../store/projects.js'
import { eventStore, messageStore, sessionStore } from '../../store/sessions.js'
import { parseToolCallsJson, selectToolCallDetail, summarizeToolCalls } from '../../store/tool-call-history.js'
import { parseFileChangesJson } from '../../store/file-changes.js'
import { calculateFileChangesForToolsInWorker } from '../../core/file-change-worker-client.js'
import { turnProcessItemStore } from '../../store/turn-process-items.js'
import type { FileChangeDetailData } from '../../types/ws-protocol.js'
import type { AgentRow } from '../../store/agents.js'
import type { RpcHandlerMap } from './types.js'
import { getQueryPort } from '../../queries/query-port-provider.js'
import { getRuntimePort } from '../../runtime/runtime-port-provider.js'
import { buildRuntimeStateSnapshot } from '../../runtime/api/runtime-snapshot.js'
import { randomUUID } from 'node:crypto'
import { executeSessionCommand } from '../../commands/session-command-service.js'
import { executeSessionBulkAction, MAX_SESSION_BULK_IDS } from '../../core/session-bulk-actions.js'

const log = createChildLogger('rpc-sessions')

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

function buildStoredFileChanges(raw: string | null): FileChangeDetailData | undefined {
  const summary = parseFileChangesJson(raw)
  if (!summary) return undefined
  return {
    files: summary.files.map((file) => ({ ...file, segments: [] })),
    totalAdded: summary.totalAdded,
    totalDeleted: summary.totalDeleted,
  }
}

export const sessionRpcHandlers: RpcHandlerMap = {
  async 'session.setModel'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const modelId = msg.modelId as string
    await configureSessionRuntime(sessionId, { modelId })
    sendResult({ modelId })
  },

  async 'session.getModels'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const caps = await getSessionRuntimeCapabilities(sessionId, { emitLifecycle: false })
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
    await configureSessionRuntime(sessionId, { modeId })
    sendResult({ modeId })
  },

  async 'session.setConfig'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const configId = msg.configId as string
    const value = msg.value as string | boolean
    await configureSessionRuntime(sessionId, { config: { [configId]: value } })
    sendResult({ configId, value })
  },

  async 'session.fork'(msg, { state, sendResult }) {
    const sessionId = msg.sessionId as string
    const source = sessionStore.get(sessionId)
    if (!source) throw new Error('会话不存在')
    const forked = sessionStore.create({ agentId: source.agent_id, taskId: source.task_id ?? undefined, projectId: source.project_id ?? undefined })
    try {
      const project = source.project_id ? projectStore.get(source.project_id) : undefined
      const snapshot = buildRuntimeStateSnapshot({
        sessionId: forked.id,
        projectId: source.project_id ?? undefined,
        cwd: project?.work_dir,
      })
      const sourceAcpSessionId = source.acp_session_id
      if (!sourceAcpSessionId) throw new Error('源会话没有可复制的运行时上下文')
      const acpSessionId = await getRuntimePort().forkSession(snapshot, sourceAcpSessionId)
      sessionStore.updateAcpSessionId(forked.id, acpSessionId)
      state.subscriptions.add(forked.id)
      sendResult(sessionStore.get(forked.id))
    } catch (err) {
      sessionStore.updateStatus(forked.id, 'closed')
      throw new Error(err instanceof Error ? err.message : 'fork 会话失败', { cause: err })
    }
  },

  async 'permission.respond'(msg, { sendResult }) {
    sendResult(await executeSessionCommand({
      commandId: legacyCommandId(msg.requestId),
      type: 'permission.respond',
      sessionId: msg.sessionId as string,
      permissionRequestId: msg.permissionRequestId as string,
      optionId: msg.optionId as string | undefined,
      cancelled: msg.cancelled as boolean | undefined,
    }))
  },

  async 'elicitation.respond'(msg, { sendResult }) {
    sendResult(await executeSessionCommand({
      commandId: legacyCommandId(msg.requestId),
      type: 'elicitation.respond',
      sessionId: msg.sessionId as string,
      elicitationRequestId: msg.elicitationRequestId as string,
      action: msg.action as 'accept' | 'decline' | 'cancel',
      content: msg.content as Record<string, string | number | boolean | string[]> | undefined,
    }))
  },

  async 'session.cancel'(msg, { sendResult }) {
    sendResult(await executeSessionCommand({
      commandId: legacyCommandId(msg.requestId),
      type: 'session.cancel',
      sessionId: msg.sessionId as string,
    }))
  },

  async 'sessions.list'(msg, { sendResult }) {
    sendResult(await getQueryPort().listSessions({
      agentId: msg.agentId as string | undefined,
      projectId: msg.projectId as string | undefined,
    }))
  },

  'sessions.listByTask'(msg, { sendResult }) {
    const taskId = msg.taskId as string
    if (!taskId) throw new Error('taskId 为必填')
    sendResult(sessionStore.listByTask(taskId))
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

  async 'sessions.bulkAction'(msg, { state, sendResult }) {
    const action = msg.action
    if (action !== 'markRead' && action !== 'delete') throw new Error('不支持的批量会话操作')
    const agentId = requiredBulkText(msg.agentId, 'agentId')
    const projectId = requiredBulkText(msg.projectId, 'projectId')
    if (!Array.isArray(msg.sessionIds) || !msg.sessionIds.every((id): id is string => typeof id === 'string')) {
      throw new Error('sessionIds 必须是字符串数组')
    }
    if (msg.sessionIds.length > MAX_SESSION_BULK_IDS) throw new Error(`一次最多操作 ${MAX_SESSION_BULK_IDS} 个会话`)
    const result = await executeSessionBulkAction(
      { action, agentId, projectId, sessionIds: msg.sessionIds },
      sessionManager.isPromptActive,
    )
    if (action === 'delete') {
      for (const sessionId of result.succeeded) state.subscriptions.delete(sessionId)
    }
    sendResult(result)
  },

  async 'sessions.messages'(msg, { sendResult }) {
    const page = await getQueryPort().listSessionMessages({
      sessionId: msg.sessionId as string,
      limit: msg.limit as number | undefined,
      before: msg.before as string | undefined,
      includeToolCalls: msg.includeToolCalls as boolean | undefined,
      includeLatestToolCalls: msg.includeLatestToolCalls as boolean | undefined,
    })
    sendResult(page.items)
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

  async 'sessions.messageFileChanges'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string
    const message = getSessionMessage(sessionId, msg.messageId as string)
    const processChanges = buildProcessFileChanges(message.id)
    if (processChanges) {
      sendResult(processChanges)
      return
    }
    const stored = buildStoredFileChanges(message.file_changes_json)
    if (stored) {
      sendResult(stored)
      return
    }
    sendResult(await calculateFileChangesForToolsInWorker(parseToolCallsJson(message.tool_calls_json)))
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

  async 'sessions.events'(msg, { sendResult }) {
    const page = await getQueryPort().listSessionEvents({
      sessionId: msg.sessionId as string,
      limit: msg.limit as number | undefined,
      afterSequence: msg.afterSequence as number | undefined,
    })
    sendResult(page.items)
  },

  async 'sessions.markRead'(msg, { sendResult }) {
    sendResult(await executeSessionCommand({
      commandId: legacyCommandId(msg.requestId),
      type: 'sessions.markRead',
      sessionId: msg.sessionId as string,
    }))
  },

  async 'sessions.markUnread'(msg, { sendResult }) {
    sendResult(await executeSessionCommand({
      commandId: legacyCommandId(msg.requestId),
      type: 'sessions.markUnread',
      sessionId: msg.sessionId as string,
    }))
  },
}

function requiredBulkText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 不能为空`)
  return value.trim()
}

function legacyCommandId(requestId: string | undefined): string {
  return requestId ? `legacy-${requestId}` : `legacy-${randomUUID()}`
}
