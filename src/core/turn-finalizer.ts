import type { SessionUpdateData, ToolCallData } from '../types/ws-protocol.js'
import { shouldCreateToolFromUpdate, upsertToolCall } from './tool-calls.js'

export interface PendingTurn {
  messageId?: string
  finalAnswer: string
  processNotes: string[]
  thinking: string
  toolCalls: ToolCallData[]
}

export interface FinalizedTurn {
  messageId?: string
  content: string
  thinking: string | null
  toolCalls?: ToolCallData[]
}

export function createPendingTurn(): PendingTurn {
  return { finalAnswer: '', processNotes: [], thinking: '', toolCalls: [] }
}

export function updatePendingTurn(turn: PendingTurn, data: SessionUpdateData): PendingTurn {
  if (!isAgentTurnUpdate(data)) return turn

  const next: PendingTurn = {
    messageId: data.messageId ?? turn.messageId,
    finalAnswer: turn.finalAnswer,
    processNotes: [...turn.processNotes],
    thinking: turn.thinking,
    toolCalls: [...turn.toolCalls],
  }

  if (data.thinking) {
    demoteFinalAnswer(next)
    next.thinking += data.thinking
  }
  if (data.toolCall) {
    demoteFinalAnswer(next)
    next.toolCalls.push(data.toolCall)
  }
  if (data.toolCallUpdate) {
    if (next.toolCalls.some((tool) => tool.id === data.toolCallUpdate?.id) || shouldCreateToolFromUpdate(data.toolCallUpdate)) {
      demoteFinalAnswer(next)
    }
    next.toolCalls = upsertToolCall(next.toolCalls, data.toolCallUpdate)
  }
  if (data.plan || data.permissionRequest || data.elicitationRequest) {
    demoteFinalAnswer(next)
  }
  if (data.contentDelta || data.content) next.finalAnswer += data.contentDelta || data.content || ''

  return next
}

export function finalizePendingTurn(turn: PendingTurn): FinalizedTurn | null {
  if (!turn.finalAnswer && !turn.thinking && turn.toolCalls.length === 0 && turn.processNotes.length === 0) return null
  return {
    messageId: turn.messageId,
    content: turn.finalAnswer,
    thinking: turn.thinking || null,
    toolCalls: turn.toolCalls.length > 0 ? turn.toolCalls : undefined,
  }
}

function demoteFinalAnswer(turn: PendingTurn): void {
  if (!turn.finalAnswer) return
  turn.processNotes.push(turn.finalAnswer)
  turn.finalAnswer = ''
}

function isAgentTurnUpdate(data: SessionUpdateData): boolean {
  const isProcessBoundary = !!(data.plan || data.permissionRequest || data.elicitationRequest)
  if (data.role === 'system' && !isProcessBoundary) return false
  return !!(data.contentDelta || data.content || data.thinking || data.toolCall || data.toolCallUpdate || isProcessBoundary)
}
