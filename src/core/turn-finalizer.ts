import type { SessionUpdateData, ToolCallData } from '../types/ws-protocol.js'
import { AUTONOMOUS_TURN_NOTICE } from '../shared/autonomous-turn.js'
import { shouldCreateToolFromUpdate, upsertToolCall } from './tool-calls.js'
import { isPlatformSupplementSource } from './session-update-source.js'
import type { SessionUpdateSource } from './session-update-source.js'

export interface PendingTurn {
  messageId?: string
  finalAnswer: string
  processNotes: string[]
  thinking: string
  toolCalls: ToolCallData[]
  /** 自治回合开场注记旁路:标记帧上的注记文本暂存于此,finalize 时拼回正文开头(见 updatePendingTurn)。 */
  wakeNotice?: string
}

export interface FinalizedTurn {
  messageId?: string
  content: string
  thinking: string | null
  toolCalls?: ToolCallData[]
}

export interface UpdatePendingTurnOptions {
  source?: SessionUpdateSource
}

export function createPendingTurn(): PendingTurn {
  return { finalAnswer: '', processNotes: [], thinking: '', toolCalls: [] }
}

export function updatePendingTurn(turn: PendingTurn, data: SessionUpdateData, options: UpdatePendingTurnOptions = {}): PendingTurn {
  if (!isAgentTurnUpdate(data)) return turn

  const next: PendingTurn = {
    messageId: data.messageId ?? turn.messageId,
    finalAnswer: turn.finalAnswer,
    processNotes: [...turn.processNotes],
    thinking: turn.thinking,
    toolCalls: [...turn.toolCalls],
    wakeNotice: turn.wakeNotice,
  }

  // 自治回合开场注记走旁路,不进 finalAnswer——否则它会被随后的 tool_call 过程边界
  // 降级进 processNotes,而合成回合没有执行过程通道(startTurnProcess 仅由真 prompt 触发),
  // 降级内容无处渲染,最终落库为空消息行。若注记与后续正文合并(同 messageId 的
  // contentDelta 帧共用聚合键),拆掉已知前缀后让余量按普通正文继续走既有聚合
  // (含过程边界降级),与"注记后单独到达的正文帧"语义一致。
  if (data.wakeNotice) {
    const text = data.contentDelta || data.content || ''
    next.wakeNotice = AUTONOMOUS_TURN_NOTICE
    const remainder = text.startsWith(AUTONOMOUS_TURN_NOTICE) ? text.slice(AUTONOMOUS_TURN_NOTICE.length) : ''
    data = { ...data, contentDelta: remainder, content: undefined }
  }

  if (data.thinking) {
    demoteFinalAnswer(next)
    next.thinking += data.thinking
  }
  if (data.toolCall) {
    const isNewTool = !next.toolCalls.some((tool) => tool.id === data.toolCall?.id)
    if (isNewTool && !isPlatformSupplementSource(options.source)) demoteFinalAnswer(next)
    next.toolCalls = upsertToolCall(next.toolCalls, data.toolCall)
  }
  if (data.toolCallUpdate) {
    const isNewTool = !next.toolCalls.some((tool) => tool.id === data.toolCallUpdate?.id)
      && shouldCreateToolFromUpdate(data.toolCallUpdate)
    if (isNewTool && !isPlatformSupplementSource(options.source)) demoteFinalAnswer(next)
    next.toolCalls = upsertToolCall(next.toolCalls, data.toolCallUpdate)
  }
  if (data.plan || data.permissionRequest || data.elicitationRequest) {
    demoteFinalAnswer(next)
  }
  if (data.contentDelta || data.content) next.finalAnswer += data.contentDelta || data.content || ''

  return next
}

export function finalizePendingTurn(turn: PendingTurn): FinalizedTurn | null {
  if (!turn.finalAnswer && !turn.thinking && !turn.wakeNotice && turn.toolCalls.length === 0 && turn.processNotes.length === 0) return null
  // 注记始终是回合正文的开头(来源标记),其后才是模型实际产出。
  const content = turn.wakeNotice
    ? (turn.finalAnswer ? `${turn.wakeNotice}\n${turn.finalAnswer}` : turn.wakeNotice)
    : turn.finalAnswer
  return {
    messageId: turn.messageId,
    content,
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
