import type { MessageData, ToolCallInfo } from '../../stores/session-events'
import type { TurnProcessBlock } from '../../stores/turn-blocks'

export type GlobalChatMsg = MessageData & {
  toolCalls?: ToolCallInfo[]
  processBlocks?: TurnProcessBlock[]
  finalAnswer?: string
  stage?: string
  streaming?: boolean
}
