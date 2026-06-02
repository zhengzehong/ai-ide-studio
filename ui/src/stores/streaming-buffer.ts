import { mergeToolCall, type ToolCallInfo } from './session-events'

export interface BufferedStreamingUpdate {
  messageId?: string
  contentDelta?: string
  thinking?: string
  toolCall?: ToolCallInfo
  toolCallUpdate?: ToolCallInfo
}

export interface StreamingBufferSnapshot {
  messageId?: string
  contentDelta?: string
  thinking?: string
  toolCalls: ToolCallInfo[]
  toolCallUpdates: ToolCallInfo[]
}

export class StreamingBuffer {
  private messageId?: string
  private contentDelta = ''
  private thinking = ''
  private toolCalls: ToolCallInfo[] = []
  private toolCallUpdates: ToolCallInfo[] = []

  push(update: BufferedStreamingUpdate): void {
    if (update.messageId) this.messageId = update.messageId
    if (update.contentDelta) this.contentDelta += update.contentDelta
    if (update.thinking) this.thinking += update.thinking
    if (update.toolCall) this.toolCalls.push(update.toolCall)
    if (update.toolCallUpdate) this.toolCallUpdates = upsertBufferedToolUpdate(this.toolCallUpdates, update.toolCallUpdate)
  }

  hasPending(): boolean {
    return !!(this.contentDelta || this.thinking || this.toolCalls.length || this.toolCallUpdates.length)
  }

  flush(): StreamingBufferSnapshot | null {
    if (!this.hasPending()) return null
    const snapshot: StreamingBufferSnapshot = {
      messageId: this.messageId,
      contentDelta: this.contentDelta || undefined,
      thinking: this.thinking || undefined,
      toolCalls: this.toolCalls,
      toolCallUpdates: this.toolCallUpdates,
    }
    this.contentDelta = ''
    this.thinking = ''
    this.toolCalls = []
    this.toolCallUpdates = []
    return snapshot
  }

  clear(): void {
    this.messageId = undefined
    this.contentDelta = ''
    this.thinking = ''
    this.toolCalls = []
    this.toolCallUpdates = []
  }
}

function upsertBufferedToolUpdate(tools: ToolCallInfo[], update: ToolCallInfo): ToolCallInfo[] {
  const idx = tools.findIndex((tool) => tool.id === update.id)
  if (idx >= 0) {
    const next = [...tools]
    next[idx] = mergeToolCall(next[idx], update)
    return next
  }
  return [...tools, mergeToolCall({ id: update.id, title: update.title || `工具调用 #${update.id.slice(-6)}` }, update)]
}
