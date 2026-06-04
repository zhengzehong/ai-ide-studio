import { randomUUID } from 'node:crypto'
import type { SessionActivityReason, SessionUpdateData } from '../types/ws-protocol.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('prompt-diagnostics')

const PROMPT_WATCHDOG_MS = readPositiveMs(process.env.PROMPT_WATCHDOG_MS, 60_000)
const PROMPT_WATCHDOG_INTERVAL_MS = readPositiveMs(process.env.PROMPT_WATCHDOG_INTERVAL_MS, 30_000)
const activePromptDiagnostics = new Map<string, PromptDiagnosticState>()
let promptWatchdogTimer: ReturnType<typeof setInterval> | null = null

export interface PromptDiagnosticState {
  turnId: string
  sessionId: string
  agentId: string
  projectId?: string | null
  startedAt: number
  lastProgressAt: number
  lastProgress: string
  warnedAt?: number
}

export function createTurnId(): string {
  return `turn-${randomUUID().slice(0, 8)}`
}

export function startPromptDiagnostics(state: PromptDiagnosticState): void {
  activePromptDiagnostics.set(state.sessionId, state)
  ensurePromptWatchdog()
}

export function recordPromptProgress(sessionId: string, progress: string): void {
  const state = activePromptDiagnostics.get(sessionId)
  if (!state) return
  state.lastProgressAt = Date.now()
  state.lastProgress = progress
}

export function finishPromptDiagnostics(sessionId: string, reason: SessionActivityReason): void {
  const state = activePromptDiagnostics.get(sessionId)
  if (!state) return
  activePromptDiagnostics.delete(sessionId)
  log.debug(
    { sessionId, agentId: state.agentId, turnId: state.turnId, reason, elapsedMs: Date.now() - state.startedAt, lastProgress: state.lastProgress },
    'prompt diagnostics finished',
  )
}

export function getPromptTurnId(sessionId: string): string | undefined {
  return activePromptDiagnostics.get(sessionId)?.turnId
}

export function summarizeSessionUpdate(data: SessionUpdateData): string {
  if (data.contentDelta || data.content) return data.eventType || 'message.chunk'
  if (data.thinking) return 'thinking.chunk'
  if (data.toolCall) return `tool.call:${data.toolCall.id}`
  if (data.toolCallUpdate) return `tool.update:${data.toolCallUpdate.id}:${data.toolCallUpdate.status ?? 'unknown'}`
  if (data.usage) return 'usage.update'
  if (data.turnUsage) return 'turn.usage.update'
  if (data.plan) return 'plan.update'
  if (data.configOptions) return 'config.update'
  if (data.commands) return 'commands.update'
  if (data.sessionInfo) return 'session.info'
  if (data.permissionRequest) return `permission.request:${data.permissionRequest.id}`
  if (data.elicitationRequest) return `elicitation.request:${data.elicitationRequest.id}`
  if (data.attachments) return 'message.attachments'
  return data.eventType || 'session.update'
}

export function summarizeSessionUpdateData(data: SessionUpdateData): Record<string, unknown> {
  return {
    messageId: data.messageId,
    role: data.role,
    updateType: summarizeSessionUpdate(data),
    contentDeltaLength: data.contentDelta?.length,
    contentLength: data.content?.length,
    thinkingLength: data.thinking?.length,
    toolCallId: data.toolCall?.id ?? data.toolCallUpdate?.id,
    toolStatus: data.toolCall?.status ?? data.toolCallUpdate?.status,
    hasUsage: !!data.usage,
    hasTurnUsage: !!data.turnUsage,
    planCount: data.plan?.length,
  }
}

function readPositiveMs(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function ensurePromptWatchdog(): void {
  if (promptWatchdogTimer || PROMPT_WATCHDOG_MS <= 0 || PROMPT_WATCHDOG_INTERVAL_MS <= 0) return
  promptWatchdogTimer = setInterval(runPromptWatchdog, PROMPT_WATCHDOG_INTERVAL_MS)
  promptWatchdogTimer.unref?.()
}

function runPromptWatchdog(): void {
  if (activePromptDiagnostics.size === 0) return
  const now = Date.now()
  for (const state of activePromptDiagnostics.values()) {
    const activeForMs = now - state.startedAt
    const idleForMs = now - state.lastProgressAt
    if (idleForMs < PROMPT_WATCHDOG_MS) continue
    if (state.warnedAt && now - state.warnedAt < PROMPT_WATCHDOG_MS) continue
    state.warnedAt = now
    log.warn(
      {
        sessionId: state.sessionId,
        agentId: state.agentId,
        projectId: state.projectId,
        turnId: state.turnId,
        activeForMs,
        idleForMs,
        lastProgress: state.lastProgress,
        lastProgressAt: new Date(state.lastProgressAt).toISOString(),
      },
      'active prompt watchdog warning',
    )
  }
}
