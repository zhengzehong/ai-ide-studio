import {
  buildChatTimelineFromEvents,
  groupChatTimelineItems,
  type ChatTimelineGroup,
  type SessionEventData,
} from '../../stores/session-events'

export interface ChatRenderMessage {
  id: string
  session_id?: string
  role: string
  content: string
  thinking?: string | null
  tool_calls_json?: string | null
  decision_json?: string | null
  attachments_json?: string | null
  timestamp?: string
  has_tool_calls?: boolean
  tool_call_count?: number
}

export type ChatRenderItem<TMessage extends ChatRenderMessage = ChatRenderMessage> =
  | { id: string; kind: 'message'; message: TMessage }
  | { id: string; kind: 'group'; group: ChatTimelineGroup }
  | { id: string; kind: 'streaming'; message: TMessage }
  | { id: string; kind: 'blocking' }

export function buildChatRenderItems<TMessage extends ChatRenderMessage>({
  sessionId,
  messages,
  events,
  streamingBubble,
  showStreamingBubble,
  blockingInteraction,
  timelineEventLimit = 1000,
}: {
  sessionId?: string | null
  messages: TMessage[]
  events: SessionEventData[]
  streamingBubble: TMessage | null
  showStreamingBubble: boolean
  blockingInteraction: boolean
  timelineEventLimit?: number
}): ChatRenderItem<TMessage>[] {
  const scopedMessages = sessionId ? messages.filter((message) => message.session_id === sessionId) : messages
  const scopedEvents = sessionId ? events.filter((event) => event.session_id === sessionId) : events
  const scopedStreamingBubble =
    sessionId && streamingBubble?.session_id && streamingBubble.session_id !== sessionId ? null : streamingBubble
  const items: ChatRenderItem<TMessage>[] = scopedMessages.length > 0
    ? scopedMessages.map((message) => ({ id: `msg:${message.id}`, kind: 'message', message }))
    : groupChatTimelineItems(buildChatTimelineFromEvents(scopedEvents.slice(-timelineEventLimit)))
      .map((group) => ({ id: `group:${group.id}`, kind: 'group', group }))

  if (showStreamingBubble && scopedStreamingBubble) {
    items.push({ id: `streaming:${scopedStreamingBubble.id}`, kind: 'streaming', message: scopedStreamingBubble })
  }
  if (blockingInteraction && !showStreamingBubble) items.push({ id: 'blocking', kind: 'blocking' })
  return items
}
