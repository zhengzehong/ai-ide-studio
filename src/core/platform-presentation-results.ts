import type { SessionUpdateData, ToolCallData } from '../types/ws-protocol.js'
import { onBeforeDatabaseClose } from '../store/db.js'
import { createChildLogger } from './logger.js'
import { events } from './events.js'

const PRESENTATION_TOOL_NAMES = new Set(['files.present', 'preview.publish'])
const RESULT_TTL_MS = 5 * 60_000
const log = createChildLogger('platform-presentation-results')

interface PendingPresentationResult {
  auditId: string
  sessionId: string
  agentId: string
  toolName: string
  inputKey: string
  rawInput: unknown
  rawOutput: unknown
  timer: NodeJS.Timeout
}

interface ObservedPresentationCall {
  messageId: string
  toolName: string
  inputKey: string
  toolCall: ToolCallData
  timer: NodeJS.Timeout
}

export interface RecordPlatformPresentationResultInput {
  auditId: string
  sessionId: string
  agentId: string
  toolName: string
  input: unknown
  rawOutput: unknown
}

export interface ReconciledPresentationUpdate {
  data: SessionUpdateData
  matched: boolean
}

const pendingBySession = new Map<string, PendingPresentationResult[]>()
const observedBySession = new Map<string, ObservedPresentationCall[]>()

onBeforeDatabaseClose(() => resetPlatformPresentationResults())

export function recordPlatformPresentationResult(input: RecordPlatformPresentationResultInput): void {
  if (!PRESENTATION_TOOL_NAMES.has(input.toolName)) return
  const inputKey = stableJson(input.input)
  const observed = takeObservedCall(input.sessionId, input.toolName, inputKey)
  if (observed) {
    events.emit('session:update', {
      sessionId: input.sessionId,
      agentId: input.agentId,
      data: completedUpdate(observed.messageId, observed.toolCall, input.toolName, input.input, input.rawOutput),
    })
    log.debug(
      { sessionId: input.sessionId, agentId: input.agentId, auditId: input.auditId, toolName: input.toolName, toolCallId: observed.toolCall.id },
      'late platform presentation result matched to observed ACP tool call',
    )
    return
  }
  const entry: PendingPresentationResult = {
    ...input,
    inputKey,
    rawInput: input.input,
    timer: setTimeout(() => removeEntry(input.sessionId, input.auditId), RESULT_TTL_MS),
  }
  entry.timer.unref?.()
  const pending = pendingBySession.get(input.sessionId) ?? []
  pending.push(entry)
  pendingBySession.set(input.sessionId, pending)
  log.debug(
    { sessionId: input.sessionId, agentId: input.agentId, auditId: input.auditId, toolName: input.toolName },
    'platform presentation result recorded',
  )
}

export function reconcilePlatformPresentationUpdate(
  sessionId: string,
  data: SessionUpdateData,
): ReconciledPresentationUpdate {
  const toolCall = data.toolCall ?? data.toolCallUpdate
  if (!toolCall) return { data, matched: false }
  const toolName = platformToolName(toolCall)
  if (!toolName) return { data, matched: false }
  const pending = pendingBySession.get(sessionId)
  const callInput = toolCallInput(toolCall.rawInput)
  const inputKey = callInput === undefined ? undefined : stableJson(callInput)
  const index = pending?.findIndex((entry) => (
    entry.toolName === toolName && (inputKey === undefined || entry.inputKey === inputKey)
  )) ?? -1
  if (index < 0) {
    if (data.toolCall) rememberObservedCall(sessionId, data.messageId, toolName, inputKey, toolCall)
    return { data, matched: false }
  }
  const entry = takeEntry(sessionId, index)
  if (!entry) return { data, matched: false }
  const completed: ToolCallData = {
    ...toolCall,
    title: entry.toolName,
    status: 'completed',
    rawInput: toolCall.rawInput ?? entry.rawInput,
    rawOutput: toolCall.rawOutput ?? entry.rawOutput,
  }
  log.debug(
    { sessionId, auditId: entry.auditId, toolName: entry.toolName, toolCallId: toolCall.id },
    'platform presentation result matched to ACP tool call',
  )
  return {
    matched: true,
    data: {
      ...data,
      role: 'agent',
      ...(data.toolCall ? { toolCall: completed } : { toolCallUpdate: completed }),
    },
  }
}

export function drainPlatformPresentationResults(sessionId: string, messageId: string): SessionUpdateData[] {
  const pending = pendingBySession.get(sessionId) ?? []
  pendingBySession.delete(sessionId)
  clearObservedSession(sessionId)
  if (pending.length > 0) {
    log.warn(
      { sessionId, messageId, resultCount: pending.length },
      'attaching unmatched platform presentation results before session done',
    )
  }
  return pending.map((entry) => {
    clearTimeout(entry.timer)
    return {
      messageId,
      role: 'agent',
      toolCallUpdate: {
        id: entry.auditId,
        title: entry.toolName,
        status: 'completed',
        rawInput: entry.rawInput,
        rawOutput: entry.rawOutput,
      },
    }
  })
}

export function resetPlatformPresentationResults(): void {
  for (const pending of pendingBySession.values()) {
    for (const entry of pending) clearTimeout(entry.timer)
  }
  pendingBySession.clear()
  for (const observed of observedBySession.values()) {
    for (const entry of observed) clearTimeout(entry.timer)
  }
  observedBySession.clear()
}

function platformToolName(toolCall: ToolCallData): string | null {
  const input = record(toolCall.rawInput)
  if (typeof input?.tool === 'string' && PRESENTATION_TOOL_NAMES.has(input.tool)) return input.tool
  if (PRESENTATION_TOOL_NAMES.has(toolCall.title)) return toolCall.title
  if (toolCall.title === 'mcp__ai-ide-tools__files_present' || toolCall.title === 'mcp.ai-ide-tools.files.present') {
    return 'files.present'
  }
  if (toolCall.title === 'mcp__ai-ide-tools__preview_publish' || toolCall.title === 'mcp.ai-ide-tools.preview.publish') {
    return 'preview.publish'
  }
  return null
}

function toolCallInput(value: unknown): unknown {
  const input = record(value)
  return input && 'arguments' in input ? input.arguments : value
}

function takeEntry(sessionId: string, index: number): PendingPresentationResult | undefined {
  const pending = pendingBySession.get(sessionId)
  if (!pending) return undefined
  const [entry] = pending.splice(index, 1)
  if (pending.length === 0) pendingBySession.delete(sessionId)
  if (entry) clearTimeout(entry.timer)
  return entry
}

function removeEntry(sessionId: string, auditId: string): void {
  const pending = pendingBySession.get(sessionId)
  if (!pending) return
  const index = pending.findIndex((entry) => entry.auditId === auditId)
  if (index >= 0) pending.splice(index, 1)
  if (pending.length === 0) pendingBySession.delete(sessionId)
}

function rememberObservedCall(
  sessionId: string,
  messageId: string,
  toolName: string,
  inputKey: string | undefined,
  toolCall: ToolCallData,
): void {
  const observed = observedBySession.get(sessionId) ?? []
  if (observed.some((entry) => entry.toolCall.id === toolCall.id)) return
  const entry: ObservedPresentationCall = {
    messageId,
    toolName,
    inputKey: inputKey ?? stableJson(toolCall.rawInput),
    toolCall,
    timer: setTimeout(() => removeObservedCall(sessionId, toolCall.id), RESULT_TTL_MS),
  }
  entry.timer.unref?.()
  observed.push(entry)
  observedBySession.set(sessionId, observed)
}

function takeObservedCall(
  sessionId: string,
  toolName: string,
  inputKey: string,
): ObservedPresentationCall | undefined {
  const observed = observedBySession.get(sessionId)
  if (!observed) return undefined
  const index = observed.findIndex((entry) => entry.toolName === toolName && entry.inputKey === inputKey)
  if (index < 0) return undefined
  const [entry] = observed.splice(index, 1)
  if (observed.length === 0) observedBySession.delete(sessionId)
  if (entry) clearTimeout(entry.timer)
  return entry
}

function removeObservedCall(sessionId: string, toolCallId: string): void {
  const observed = observedBySession.get(sessionId)
  if (!observed) return
  const index = observed.findIndex((entry) => entry.toolCall.id === toolCallId)
  if (index >= 0) observed.splice(index, 1)
  if (observed.length === 0) observedBySession.delete(sessionId)
}

function clearObservedSession(sessionId: string): void {
  const observed = observedBySession.get(sessionId) ?? []
  for (const entry of observed) clearTimeout(entry.timer)
  observedBySession.delete(sessionId)
}

function completedUpdate(
  messageId: string,
  toolCall: ToolCallData,
  toolName: string,
  rawInput: unknown,
  rawOutput: unknown,
): SessionUpdateData {
  return {
    messageId,
    role: 'agent',
    toolCallUpdate: {
      ...toolCall,
      title: toolName,
      status: 'completed',
      rawInput: toolCall.rawInput ?? rawInput,
      rawOutput: toolCall.rawOutput ?? rawOutput,
    },
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value)) ?? 'undefined'
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  const object = record(value)
  if (!object) return value
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonicalize(object[key])]))
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
