import { randomUUID } from 'crypto'
import type { ElicitationRequestData, PermissionRequestData, PlanEntry, SessionUpdateData, ToolCallData } from '../types/ws-protocol.js'
import { buildFileChangesFromToolCalls } from '../store/file-changes.js'
import { onBeforeDatabaseClose } from '../store/db.js'
import { messageStore } from '../store/sessions.js'
import { stableProcessItemId, turnProcessItemStore, type TurnProcessItemRow } from '../store/turn-process-items.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { mergeToolCall, shouldCreateToolFromUpdate } from './tool-calls.js'

const log = createChildLogger('turn-process-runtime')

interface ActiveTurnProcess {
  messageId: string
  finalAnswer: string
  lastTextItemId?: string
  lastTextKind?: 'thinking' | 'note' | 'stage' | 'error'
  noteIndex: number
  snapshotTimer?: NodeJS.Timeout
  snapshotPending: boolean
  pendingText?: {
    kind: 'thinking' | 'note' | 'stage' | 'error'
    text: string
    timer?: NodeJS.Timeout
  }
}

const activeTurns = new Map<string, ActiveTurnProcess>()
const SNAPSHOT_FLUSH_INTERVAL_MS = 500
const PROCESS_TEXT_FLUSH_INTERVAL_MS = 300

onBeforeDatabaseClose(() => resetTurnProcessRuntime())

export function createAgentMessageId(): string {
  return `msg-turn-${Date.now()}-${randomUUID().slice(0, 8)}`
}

export function startTurnProcess(sessionId: string, messageId: string): void {
  activeTurns.set(sessionId, { messageId, finalAnswer: '', noteIndex: 0, snapshotPending: false })
  log.debug({ sessionId, messageId }, 'active turn process started')
}

export function recordTurnProcessUpdate(sessionId: string, agentId: string, data: SessionUpdateData): void {
  const active = activeTurns.get(sessionId)
  if (!active) return
  if (data.messageId && data.messageId !== active.messageId && data.role === 'agent') return

  if (data.role === 'agent' && (data.contentDelta || data.content)) {
    active.finalAnswer += data.contentDelta || data.content || ''
    scheduleSnapshotFlush(sessionId, active)
    return
  }

  if (data.thinking) {
    demoteFinalAnswer(sessionId, active, agentId)
    scheduleProcessTextFlush(sessionId, active, agentId, 'thinking', data.thinking)
    return
  }

  if (data.toolCall) {
    flushProcessText(sessionId, active, agentId)
    demoteFinalAnswer(sessionId, active, agentId)
    const item = upsertTool(sessionId, active.messageId, data.toolCall)
    emitProcessItem(sessionId, agentId, item)
    emitFileChangeIfPresent(sessionId, agentId, active.messageId, data.toolCall)
    active.lastTextItemId = undefined
    active.lastTextKind = undefined
    return
  }

  if (data.toolCallUpdate) {
    flushProcessText(sessionId, active, agentId)
    if (shouldCreateToolFromUpdate(data.toolCallUpdate)) demoteFinalAnswer(sessionId, active, agentId)
    const item = upsertTool(sessionId, active.messageId, data.toolCallUpdate)
    emitProcessItem(sessionId, agentId, item)
    emitFileChangeIfPresent(sessionId, agentId, active.messageId, data.toolCallUpdate)
    active.lastTextItemId = undefined
    active.lastTextKind = undefined
    return
  }

  if (data.plan) {
    flushProcessText(sessionId, active, agentId)
    demoteFinalAnswer(sessionId, active, agentId)
    const item = upsertPlan(sessionId, active.messageId, data.plan)
    emitProcessItem(sessionId, agentId, item)
    active.lastTextItemId = undefined
    active.lastTextKind = undefined
    return
  }

  if (data.permissionRequest) {
    flushProcessText(sessionId, active, agentId)
    demoteFinalAnswer(sessionId, active, agentId)
    const item = upsertPermission(sessionId, active.messageId, data.permissionRequest)
    emitProcessItem(sessionId, agentId, item)
    active.lastTextItemId = undefined
    active.lastTextKind = undefined
    return
  }

  if (data.elicitationRequest) {
    flushProcessText(sessionId, active, agentId)
    demoteFinalAnswer(sessionId, active, agentId)
    const item = upsertElicitation(sessionId, active.messageId, data.elicitationRequest)
    emitProcessItem(sessionId, agentId, item)
    active.lastTextItemId = undefined
    active.lastTextKind = undefined
    return
  }

  if (data.eventType?.startsWith('lifecycle.') && data.content) {
    const item = turnProcessItemStore.upsert({
      id: stableProcessItemId(active.messageId, 'stage', 'current'),
      sessionId,
      messageId: active.messageId,
      kind: 'stage',
      status: 'running',
      title: '状态',
      summary: data.content,
      preview: data.content,
      content: data.content,
      meta: { eventType: data.eventType },
    })
    emitProcessItem(sessionId, agentId, item)
  }
}

export function completeTurnProcess(
  sessionId: string,
  status: string,
): { messageId?: string; finalAnswer?: string; fileChangesJson?: string | null } {
  const active = activeTurns.get(sessionId)
  if (!active) return {}
  flushProcessText(sessionId, active, undefined)
  flushSnapshot(active)
  const fileChangesJson = turnProcessItemStore.aggregateFileChanges(active.messageId)
  turnProcessItemStore.completeOpen(active.messageId, status)
  if (active.snapshotTimer) clearTimeout(active.snapshotTimer)
  if (active.pendingText?.timer) clearTimeout(active.pendingText.timer)
  activeTurns.delete(sessionId)
  log.debug({ sessionId, messageId: active.messageId, status }, 'active turn process completed')
  return { messageId: active.messageId, finalAnswer: active.finalAnswer, fileChangesJson }
}

export function resetTurnProcessRuntime(): void {
  const turnCount = activeTurns.size
  for (const active of activeTurns.values()) {
    if (active.snapshotTimer) clearTimeout(active.snapshotTimer)
    if (active.pendingText?.timer) clearTimeout(active.pendingText.timer)
  }
  activeTurns.clear()
  if (turnCount > 0) log.debug({ turnCount }, 'active turn processes reset')
}

function demoteFinalAnswer(sessionId: string, active: ActiveTurnProcess, agentId: string): void {
  if (!active.finalAnswer) return
  flushProcessText(sessionId, active, agentId)
  flushSnapshot(active)
  active.noteIndex += 1
  const item = turnProcessItemStore.upsert({
    id: stableProcessItemId(active.messageId, 'note', String(active.noteIndex)),
    sessionId,
    messageId: active.messageId,
    kind: 'note',
    status: 'completed',
    title: '中间说明',
    summary: summarizeText(active.finalAnswer),
    preview: summarizeText(active.finalAnswer),
    content: active.finalAnswer,
  })
  emitProcessItem(sessionId, agentId, item)
  active.finalAnswer = ''
  flushSnapshot(active, true)
  active.lastTextItemId = undefined
  active.lastTextKind = undefined
}

function scheduleProcessTextFlush(
  sessionId: string,
  active: ActiveTurnProcess,
  agentId: string,
  kind: 'thinking' | 'note' | 'stage' | 'error',
  text: string,
): void {
  if (active.pendingText && active.pendingText.kind !== kind) {
    flushProcessText(sessionId, active, agentId)
  }
  active.pendingText = {
    kind,
    text: `${active.pendingText?.text ?? ''}${text}`,
    timer: active.pendingText?.timer,
  }
  if (active.pendingText.timer) return
  active.pendingText.timer = setTimeout(() => {
    const current = activeTurns.get(sessionId)
    if (!current || current !== active) return
    flushProcessText(sessionId, current, agentId)
  }, PROCESS_TEXT_FLUSH_INTERVAL_MS)
}

function flushProcessText(sessionId: string, active: ActiveTurnProcess, agentId: string | undefined): void {
  const pending = active.pendingText
  if (!pending) return
  if (pending.timer) clearTimeout(pending.timer)
  active.pendingText = undefined
  if (!pending.text) return
  const item = appendText(sessionId, active, agentId ?? '', pending.kind, pending.text)
  emitProcessItem(sessionId, agentId ?? '', item)
}

function scheduleSnapshotFlush(sessionId: string, active: ActiveTurnProcess): void {
  active.snapshotPending = true
  if (active.snapshotTimer) return
  active.snapshotTimer = setTimeout(() => {
    const current = activeTurns.get(sessionId)
    if (!current || current !== active) return
    current.snapshotTimer = undefined
    flushSnapshot(current)
  }, SNAPSHOT_FLUSH_INTERVAL_MS)
}

function flushSnapshot(active: ActiveTurnProcess, force = false): void {
  if (active.snapshotTimer) {
    clearTimeout(active.snapshotTimer)
    active.snapshotTimer = undefined
  }
  if (!active.snapshotPending && !force) return
  messageStore.updateRunningSnapshot(active.messageId, active.finalAnswer)
  active.snapshotPending = false
}

function appendText(
  sessionId: string,
  active: ActiveTurnProcess,
  agentId: string,
  kind: 'thinking' | 'note' | 'stage' | 'error',
  text: string,
): TurnProcessItemRow {
  const reuse = active.lastTextKind === kind ? active.lastTextItemId : undefined
  const item = turnProcessItemStore.appendText({
    id: reuse ?? stableProcessItemId(active.messageId, kind, `${kind}-${Date.now()}-${randomUUID().slice(0, 4)}`),
    sessionId,
    messageId: active.messageId,
    kind,
    text,
    status: 'running',
  })
  active.lastTextItemId = item.id
  active.lastTextKind = kind
  log.debug({ sessionId, agentId, messageId: active.messageId, itemId: item.id, kind }, 'text process item appended')
  return item
}

function upsertTool(sessionId: string, messageId: string, toolCall: ToolCallData): TurnProcessItemRow {
  const id = stableProcessItemId(messageId, 'tool', toolCall.id)
  const merged = mergeStoredToolCall(id, toolCall)
  return turnProcessItemStore.upsert({
    id,
    sessionId,
    messageId,
    kind: 'tool',
    status: merged.status ?? 'running',
    title: merged.title,
    summary: toolSummary(merged),
    preview: toolPreview(toolCall),
    detail: toolCallWithoutDiff(merged),
    meta: { toolCallId: merged.id },
  })
}

function mergeStoredToolCall(itemId: string, update: ToolCallData): ToolCallData {
  const existing = turnProcessItemStore.get(itemId)
  const previous = parseToolCallDetail(existing?.detail_json)
  return previous ? mergeToolCall(previous, update) : update
}

function emitFileChangeIfPresent(sessionId: string, agentId: string, messageId: string, toolCall: ToolCallData): void {
  const changes = buildFileChangesFromToolCalls([toolCall])
  if (changes.files.length === 0) return
  const item = turnProcessItemStore.upsert({
    id: stableProcessItemId(messageId, 'file_change', toolCall.id),
    sessionId,
    messageId,
    kind: 'file_change',
    status: toolCall.status ?? 'completed',
    title: '文件修改',
    summary: `修改 ${changes.files.length} 个文件，+${changes.totalAdded} -${changes.totalDeleted}`,
    preview: changes.files.map((file) => file.path).join(', '),
    detail: changes,
    meta: { toolCallId: toolCall.id },
  })
  emitProcessItem(sessionId, agentId, item)
}

function upsertPlan(sessionId: string, messageId: string, plan: PlanEntry[]): TurnProcessItemRow {
  const counts = plan.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1
    return acc
  }, {})
  return turnProcessItemStore.upsert({
    id: stableProcessItemId(messageId, 'plan', 'current'),
    sessionId,
    messageId,
    kind: 'plan',
    status: plan.some((item) => item.status === 'in_progress') ? 'running' : 'completed',
    title: '计划',
    summary: `计划 ${plan.length} 项`,
    preview: Object.entries(counts).map(([status, count]) => `${status} ${count}`).join(' · '),
    content: JSON.stringify({ plan }),
    detail: { plan },
  })
}

function upsertPermission(sessionId: string, messageId: string, permission: PermissionRequestData): TurnProcessItemRow {
  return turnProcessItemStore.upsert({
    id: stableProcessItemId(messageId, 'permission', permission.id),
    sessionId,
    messageId,
    kind: 'permission',
    status: 'pending',
    title: '权限请求',
    summary: permission.toolCall.title,
    preview: permission.options.map((option) => option.name).join(' / '),
    detail: { permissionRequest: permission },
    meta: { requestId: permission.id, toolCallId: permission.toolCall.id },
  })
}

function upsertElicitation(sessionId: string, messageId: string, elicitation: ElicitationRequestData): TurnProcessItemRow {
  return turnProcessItemStore.upsert({
    id: stableProcessItemId(messageId, 'elicitation', elicitation.id),
    sessionId,
    messageId,
    kind: 'elicitation',
    status: 'pending',
    title: 'AI 提问',
    summary: elicitation.message ?? '需要补充信息',
    preview: elicitation.message ?? '',
    detail: { elicitationRequest: elicitation },
    meta: { requestId: elicitation.id, toolCallId: elicitation.toolCallId },
  })
}

function emitProcessItem(sessionId: string, agentId: string, item: TurnProcessItemRow): void {
  events.emit('session:process_item', {
    sessionId,
    agentId,
    item: {
      ...item,
      detail_json: undefined,
      has_detail: !!item.detail_json,
    },
  })
}

function toolSummary(toolCall: ToolCallData): string {
  const status = toolCall.status ? ` · ${toolCall.status}` : ''
  return `${toolCall.title}${status}`
}

function toolPreview(toolCall: ToolCallData): string {
  if (toolCall.error) return toolCall.error
  if (toolCall.progressDelta) return toolCall.progressDelta
  if (toolCall.terminalOutputDelta) return toolCall.terminalOutputDelta
  if (toolCall.content?.length) return toolCall.content.map((item) => item.path || item.text || item.type).filter(Boolean).join(' · ')
  return ''
}

function toolCallWithoutDiff(toolCall: ToolCallData): ToolCallData {
  return {
    ...toolCall,
    content: toolCall.content?.filter((item) => item.type !== 'diff'),
  }
}

function parseToolCallDetail(raw?: string | null): ToolCallData | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ToolCallData>
    if (!parsed.id || !parsed.title) return null
    return parsed as ToolCallData
  } catch {
    return null
  }
}

function summarizeText(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > 120 ? `${compact.slice(0, 120)}…` : compact
}
