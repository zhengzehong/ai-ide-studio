import { randomUUID } from 'crypto'
import type { ElicitationRequestData, PermissionRequestData, PlanEntry, SessionUpdateData, ToolCallData } from '../types/ws-protocol.js'
import { buildFileChangesFromToolCalls } from '../store/file-changes.js'
import { messageStore } from '../store/sessions.js'
import { stableProcessItemId, turnProcessItemStore, type TurnProcessItemRow } from '../store/turn-process-items.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { shouldCreateToolFromUpdate } from './tool-calls.js'

const log = createChildLogger('turn-process-runtime')

interface ActiveTurnProcess {
  messageId: string
  finalAnswer: string
  lastTextItemId?: string
  lastTextKind?: 'thinking' | 'note' | 'stage' | 'error'
  noteIndex: number
}

const activeTurns = new Map<string, ActiveTurnProcess>()

export function createAgentMessageId(): string {
  return `msg-turn-${Date.now()}-${randomUUID().slice(0, 8)}`
}

export function startTurnProcess(sessionId: string, messageId: string): void {
  activeTurns.set(sessionId, { messageId, finalAnswer: '', noteIndex: 0 })
  log.debug({ sessionId, messageId }, 'active turn process started')
}

export function recordTurnProcessUpdate(sessionId: string, agentId: string, data: SessionUpdateData): void {
  const active = activeTurns.get(sessionId)
  if (!active) return

  if (data.role === 'agent' && (data.contentDelta || data.content)) {
    active.finalAnswer += data.contentDelta || data.content || ''
    messageStore.updateRunningSnapshot(active.messageId, active.finalAnswer)
    return
  }

  if (data.thinking) {
    demoteFinalAnswer(sessionId, active, agentId)
    const item = appendText(sessionId, active, agentId, 'thinking', data.thinking)
    emitProcessItem(sessionId, agentId, item)
    return
  }

  if (data.toolCall) {
    demoteFinalAnswer(sessionId, active, agentId)
    const item = upsertTool(sessionId, active.messageId, data.toolCall)
    emitProcessItem(sessionId, agentId, item)
    emitFileChangeIfPresent(sessionId, agentId, active.messageId, data.toolCall)
    active.lastTextItemId = undefined
    active.lastTextKind = undefined
    return
  }

  if (data.toolCallUpdate) {
    if (shouldCreateToolFromUpdate(data.toolCallUpdate)) demoteFinalAnswer(sessionId, active, agentId)
    const item = upsertTool(sessionId, active.messageId, data.toolCallUpdate)
    emitProcessItem(sessionId, agentId, item)
    emitFileChangeIfPresent(sessionId, agentId, active.messageId, data.toolCallUpdate)
    active.lastTextItemId = undefined
    active.lastTextKind = undefined
    return
  }

  if (data.plan) {
    demoteFinalAnswer(sessionId, active, agentId)
    const item = upsertPlan(sessionId, active.messageId, data.plan)
    emitProcessItem(sessionId, agentId, item)
    active.lastTextItemId = undefined
    active.lastTextKind = undefined
    return
  }

  if (data.permissionRequest) {
    demoteFinalAnswer(sessionId, active, agentId)
    const item = upsertPermission(sessionId, active.messageId, data.permissionRequest)
    emitProcessItem(sessionId, agentId, item)
    active.lastTextItemId = undefined
    active.lastTextKind = undefined
    return
  }

  if (data.elicitationRequest) {
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
  const fileChangesJson = turnProcessItemStore.aggregateFileChanges(active.messageId)
  turnProcessItemStore.completeOpen(active.messageId, status)
  activeTurns.delete(sessionId)
  log.debug({ sessionId, messageId: active.messageId, status }, 'active turn process completed')
  return { messageId: active.messageId, finalAnswer: active.finalAnswer, fileChangesJson }
}

function demoteFinalAnswer(sessionId: string, active: ActiveTurnProcess, agentId: string): void {
  if (!active.finalAnswer) return
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
  messageStore.updateRunningSnapshot(active.messageId, '')
  active.lastTextItemId = undefined
  active.lastTextKind = undefined
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
  return turnProcessItemStore.upsert({
    id: stableProcessItemId(messageId, 'tool', toolCall.id),
    sessionId,
    messageId,
    kind: 'tool',
    status: toolCall.status ?? 'running',
    title: toolCall.title,
    summary: toolSummary(toolCall),
    preview: toolPreview(toolCall),
    detail: toolCallWithoutDiff(toolCall),
    meta: { toolCallId: toolCall.id },
  })
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

function summarizeText(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > 120 ? `${compact.slice(0, 120)}…` : compact
}
