import { hasMeaningfulToolTitle } from './tool-title'
import type { ElicitationRequestInfo, FileChangeDetailInfo, PermissionRequestInfo, PlanEntry, SessionEventData, ToolCallInfo, TurnProcessItemInfo, TurnUsageInfo } from './session-events'

export type TurnProcessBlockKind = 'thinking' | 'note' | 'tool' | 'stage' | 'file_change' | 'plan' | 'permission' | 'elicitation'

export interface TurnThinkingBlock {
  id: string
  kind: 'thinking'
  text: string
  sequence?: number
}

export interface TurnNoteBlock {
  id: string
  kind: 'note'
  text: string
  sequence?: number
}

export interface TurnToolBlock {
  id: string
  kind: 'tool'
  toolCall: ToolCallInfo
  sequence?: number
  hasDetail?: boolean
}

export interface TurnStageBlock {
  id: string
  kind: 'stage'
  text: string
  sequence?: number
}

export interface TurnFileChangeBlock {
  id: string
  kind: 'file_change'
  changes?: FileChangeDetailInfo
  summary?: string
  sequence?: number
  hasDetail?: boolean
}

export interface TurnPlanBlock {
  id: string
  kind: 'plan'
  plan: PlanEntry[]
  summary?: string
  sequence?: number
  hasDetail?: boolean
}

export interface TurnPermissionBlock {
  id: string
  kind: 'permission'
  title: string
  summary?: string
  preview?: string
  status?: string
  request?: PermissionRequestInfo
  sequence?: number
  hasDetail?: boolean
}

export interface TurnElicitationBlock {
  id: string
  kind: 'elicitation'
  title: string
  message?: string
  summary?: string
  preview?: string
  status?: string
  request?: ElicitationRequestInfo
  sequence?: number
  hasDetail?: boolean
}

export type TurnProcessBlock = TurnThinkingBlock | TurnNoteBlock | TurnToolBlock | TurnStageBlock | TurnFileChangeBlock | TurnPlanBlock | TurnPermissionBlock | TurnElicitationBlock

export type TurnEntry =
  | { sequence?: number; kind: 'thinking'; text: string }
  | { sequence?: number; kind: 'reply'; text: string }
  | { sequence?: number; kind: 'toolCall'; toolCall: ToolCallInfo }
  | { sequence?: number; kind: 'toolUpdate'; toolCall: ToolCallInfo }
  | { sequence?: number; kind: 'stage'; text: string }
  | { sequence?: number; kind: 'done'; turnStats?: TurnUsageInfo }

export interface TurnViewModel {
  id: string
  role: 'agent'
  processBlocks: TurnProcessBlock[]
  finalAnswer: string
  content: string
  thinking: string
  toolCalls: ToolCallInfo[]
  done: boolean
  stage?: string
  turnStats?: TurnUsageInfo
}

export function createEmptyTurn(id: string): TurnViewModel {
  return { id, role: 'agent', processBlocks: [], finalAnswer: '', content: '', thinking: '', toolCalls: [], done: false }
}

export function applyTurnEntry(turn: TurnViewModel, entry: TurnEntry): TurnViewModel {
  const next: TurnViewModel = {
    ...turn,
    processBlocks: turn.processBlocks.map(cloneProcessBlock),
  }

  switch (entry.kind) {
    case 'thinking':
      demoteFinalAnswer(next, entry.sequence)
      appendTextBlock(next, 'thinking', entry.text, entry.sequence)
      next.stage = undefined
      return syncDerivedFields(next)
    case 'reply':
      next.finalAnswer += entry.text
      next.stage = undefined
      return syncDerivedFields(next)
    case 'toolCall':
      demoteFinalAnswer(next, entry.sequence)
      next.processBlocks.push({ id: processBlockId('tool', entry.toolCall.id, entry.sequence), kind: 'tool', toolCall: entry.toolCall, sequence: entry.sequence })
      next.stage = undefined
      return syncDerivedFields(next)
    case 'toolUpdate':
      upsertToolBlock(next, entry.toolCall, entry.sequence)
      next.stage = undefined
      return syncDerivedFields(next)
    case 'stage':
      demoteFinalAnswer(next, entry.sequence)
      appendTextBlock(next, 'stage', entry.text, entry.sequence)
      next.stage = entry.text
      return syncDerivedFields(next)
    case 'done':
      next.done = true
      next.turnStats = entry.turnStats ?? next.turnStats
      next.stage = undefined
      return syncDerivedFields(next)
  }
}

export function turnFromEntries(id: string, entries: TurnEntry[]): TurnViewModel {
  return entries.reduce(applyTurnEntry, createEmptyTurn(id))
}

export function turnFromEvents(id: string, events: SessionEventData[]): TurnViewModel {
  const entries: TurnEntry[] = []
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    const payload = parsePayload(event)
    const eventMessageId = payloadMessageId(event, payload)
    if (event.type !== 'message.done' && eventMessageId && eventMessageId !== id) continue

    switch (event.type) {
      case 'message.chunk':
        if (payload.role === 'agent') entries.push({ kind: 'reply', text: String(payload.contentDelta || payload.content || ''), sequence: event.sequence })
        break
      case 'thinking.chunk':
        entries.push({ kind: 'thinking', text: String(payload.thinking || ''), sequence: event.sequence })
        break
      case 'tool.call': {
        const toolCall = payload.toolCall as ToolCallInfo | undefined
        if (toolCall?.id) entries.push({ kind: 'toolCall', toolCall, sequence: event.sequence })
        break
      }
      case 'tool.update': {
        const toolCall = payload.toolCall as ToolCallInfo | undefined
        if (toolCall?.id) entries.push({ kind: 'toolUpdate', toolCall, sequence: event.sequence })
        break
      }
      case 'message.done':
        entries.push({ kind: 'done', turnStats: payload.turnUsage as TurnUsageInfo | undefined, sequence: event.sequence })
        break
      default:
        if (event.type.startsWith('lifecycle.')) {
          const text = String(payload.content || payload.contentDelta || '')
          if (text) entries.push({ kind: 'stage', text, sequence: event.sequence })
        }
        break
    }
  }
  return turnFromEntries(id, entries)
}

export function turnFromProcessItems(id: string, items: TurnProcessItemInfo[]): TurnViewModel {
  const turn = createEmptyTurn(id)
  turn.processBlocks = [...items]
    .sort((a, b) => a.sequence - b.sequence)
    .map(processItemToBlock)
    .filter((block): block is TurnProcessBlock => !!block)
  return syncDerivedFields(turn)
}
export function turnHasVisibleContent(turn: TurnViewModel | null): turn is TurnViewModel {
  return !!turn && (!!turn.stage || !!turn.finalAnswer || (turn.processBlocks?.length ?? 0) > 0)
}

export function turnHasFinalizableContent(turn: TurnViewModel | null): turn is TurnViewModel {
  return !!turn && (!!turn.finalAnswer || (turn.processBlocks?.some((block) => block.kind !== 'stage') ?? false))
}

export function processBlocksForCompletedTurn(turn: TurnViewModel): TurnProcessBlock[] {
  if (!turn.processBlocks.some((block) => block.kind !== 'stage')) return []
  return turn.processBlocks.filter((block) => block.kind !== 'stage')
}

export function flattenProcessText(turn: TurnViewModel): { thinking: string; toolCalls: ToolCallInfo[] } {
  const thinking: string[] = []
  const toolCalls: ToolCallInfo[] = []
  for (const block of turn.processBlocks ?? []) {
    if (block.kind === 'thinking') thinking.push(block.text)
    if (block.kind === 'tool') toolCalls.push(block.toolCall)
  }
  return { thinking: thinking.join(''), toolCalls }
}

function syncDerivedFields(turn: TurnViewModel): TurnViewModel {
  const process = flattenProcessText(turn)
  return {
    ...turn,
    content: turn.finalAnswer,
    thinking: process.thinking,
    toolCalls: process.toolCalls,
  }
}

function appendTextBlock(turn: TurnViewModel, kind: 'thinking' | 'note' | 'stage', text: string, sequence?: number): void {
  if (!text) return
  const last = turn.processBlocks.at(-1)
  if (last?.kind === kind) {
    last.text = kind === 'stage' ? text : `${last.text}${text}`
    return
  }
  turn.processBlocks.push({ id: processBlockId(kind, turn.processBlocks.length, sequence), kind, text, sequence })
}

function demoteFinalAnswer(turn: TurnViewModel, sequence?: number): void {
  if (!turn.finalAnswer) return
  appendTextBlock(turn, 'note', turn.finalAnswer, sequence)
  turn.finalAnswer = ''
}

function upsertToolBlock(turn: TurnViewModel, update: ToolCallInfo, sequence?: number): void {
  const index = turn.processBlocks.findIndex((block) => block.kind === 'tool' && block.toolCall.id === update.id)
  if (index >= 0) {
    const block = turn.processBlocks[index]
    if (block.kind === 'tool') block.toolCall = mergeToolCall(block.toolCall, update)
    return
  }
  turn.processBlocks.push({ id: processBlockId('tool', update.id, sequence), kind: 'tool', toolCall: update, sequence })
}

function mergeToolCall(existing: ToolCallInfo, update: ToolCallInfo): ToolCallInfo {
  const next: ToolCallInfo = { ...existing }
  if (hasMeaningfulToolTitle(update.title) || !hasMeaningfulToolTitle(next.title)) next.title = update.title
  if (update.kind) next.kind = update.kind
  if (update.status) next.status = update.status
  if (update.locations) next.locations = update.locations
  if (update.rawInput !== undefined) next.rawInput = update.rawInput
  if (update.rawOutput !== undefined) next.rawOutput = update.rawOutput
  if (update.content) next.content = update.content
  if (update.terminalOutput !== undefined) next.terminalOutput = update.terminalOutput
  if (update.terminalOutputDelta) next.terminalOutput = `${next.terminalOutput || ''}${update.terminalOutputDelta}`
  if (update.progress) next.progress = update.progress
  if (update.progressDelta) next.progress = [...(next.progress || []), update.progressDelta]
  if (update.error !== undefined) next.error = update.error
  return next
}

function cloneProcessBlock(block: TurnProcessBlock): TurnProcessBlock {
  if (block.kind === 'tool') return { ...block, toolCall: { ...block.toolCall } }
  if (block.kind === 'file_change') return {
    ...block,
    changes: block.changes
      ? { ...block.changes, files: block.changes.files.map((file) => ({ ...file, segments: file.segments.map((segment) => ({ ...segment, lines: segment.lines.map((line) => ({ ...line })) })) })) }
      : undefined,
  }
  if (block.kind === 'plan') return { ...block, plan: block.plan.map((item) => ({ ...item })) }
  if (block.kind === 'permission') return { ...block, request: block.request ? { ...block.request, toolCall: { ...block.request.toolCall }, options: block.request.options.map((option) => ({ ...option })) } : undefined }
  if (block.kind === 'elicitation') return { ...block, request: block.request ? { ...block.request } : undefined }
  return { ...block }
}

function processBlockId(kind: TurnProcessBlockKind, seed: string | number, sequence?: number): string {
  return `turn-${kind}-${sequence ?? seed}`
}

function parsePayload(event: SessionEventData): Record<string, unknown> {
  try {
    return JSON.parse(event.payload_json) as Record<string, unknown>
  } catch {
    return {}
  }
}

function payloadMessageId(event: SessionEventData, payload: Record<string, unknown>): string | null {
  const messageId = payload.messageId ?? event.message_id
  return messageId == null ? null : String(messageId)
}

function processItemToBlock(item: TurnProcessItemInfo): TurnProcessBlock | null {
  if (item.kind === 'thinking') return { id: item.id, kind: 'thinking', text: item.content || item.summary || '', sequence: item.sequence }
  if (item.kind === 'note') return { id: item.id, kind: 'note', text: item.content || item.summary || '', sequence: item.sequence }
  if (item.kind === 'stage') return { id: item.id, kind: 'stage', text: item.content || item.summary || '', sequence: item.sequence }
  if (item.kind === 'tool') {
    const tool = parseDetail<ToolCallInfo>(item.detail_json) ?? {
      id: item.id,
      title: item.title || item.summary || '工具调用',
      status: item.status ?? undefined,
    }
    return { id: item.id, kind: 'tool', toolCall: tool, sequence: item.sequence, hasDetail: (!!item.has_detail && !item.detail_json) }
  }
  if (item.kind === 'file_change') {
    const changes = parseDetail<FileChangeDetailInfo>(item.detail_json)
    if (changes?.files.length) return { id: item.id, kind: 'file_change', changes, summary: item.summary || undefined, sequence: item.sequence, hasDetail: (!!item.has_detail && !item.detail_json) }
    if (item.summary || item.preview) return { id: item.id, kind: 'file_change', summary: item.summary || item.preview || undefined, sequence: item.sequence, hasDetail: (!!item.has_detail && !item.detail_json) }
    return null
  }
  if (item.kind === 'plan') {
    const detail = parseDetail<{ plan?: PlanEntry[] }>(item.detail_json) ?? parseDetail<{ plan?: PlanEntry[] }>(item.content)
    return { id: item.id, kind: 'plan', plan: detail?.plan || [], summary: item.summary || undefined, sequence: item.sequence, hasDetail: (!!item.has_detail && !item.detail_json) }
  }
  if (item.kind === 'permission') {
    const detail = parseDetail<{ permissionRequest?: PermissionRequestInfo }>(item.detail_json)
    const request = detail?.permissionRequest
    return {
      id: item.id,
      kind: 'permission',
      title: item.title || '权限请求',
      summary: item.summary || request?.toolCall?.title || undefined,
      preview: item.preview || undefined,
      status: item.status ?? undefined,
      request,
      sequence: item.sequence,
      hasDetail: (!!item.has_detail && !item.detail_json),
    }
  }
  if (item.kind === 'elicitation') {
    const detail = parseDetail<{ elicitationRequest?: ElicitationRequestInfo }>(item.detail_json)
    const request = detail?.elicitationRequest
    return {
      id: item.id,
      kind: 'elicitation',
      title: item.title || 'AI 提问',
      message: request?.message || item.summary || item.preview || undefined,
      summary: item.summary || undefined,
      preview: item.preview || undefined,
      status: item.status ?? undefined,
      request,
      sequence: item.sequence,
      hasDetail: (!!item.has_detail && !item.detail_json),
    }
  }
  if (item.summary || item.content) return { id: item.id, kind: 'note', text: item.content || item.summary || '', sequence: item.sequence }
  return null
}

function parseDetail<T>(raw?: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
