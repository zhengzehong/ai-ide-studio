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
  status?: string
  started_at?: string | null
  completed_at?: string | null
  stats_json?: string | null
  process_item_count?: number
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
  previousItems,
}: {
  sessionId?: string | null
  messages: TMessage[]
  events: SessionEventData[]
  streamingBubble: TMessage | null
  showStreamingBubble: boolean
  blockingInteraction: boolean
  timelineEventLimit?: number
  previousItems?: ChatRenderItem<TMessage>[]
}): ChatRenderItem<TMessage>[] {
  const previousById = new Map(previousItems?.map((item) => [item.id, item]))
  const scopedMessages = sessionId ? messages.filter((message) => message.session_id === sessionId) : messages
  const scopedEvents = sessionId ? events.filter((event) => event.session_id === sessionId) : events
  const scopedStreamingBubble =
    sessionId && streamingBubble?.session_id && streamingBubble.session_id !== sessionId ? null : streamingBubble
  const visibleMessages = scopedStreamingBubble
    ? scopedMessages.filter((message) => message.id !== scopedStreamingBubble.id)
    : scopedMessages
  const items: ChatRenderItem<TMessage>[] = scopedMessages.length > 0
    ? visibleMessages.map((message) => reuseMessageItem(previousById, message))
    : groupChatTimelineItems(buildChatTimelineFromEvents(scopedEvents.slice(-timelineEventLimit)))
      .map((group) => reuseGroupItem(previousById, group))

  if (showStreamingBubble && scopedStreamingBubble) {
    items.push({ id: `streaming:${scopedStreamingBubble.id}`, kind: 'streaming', message: scopedStreamingBubble })
  }
  if (blockingInteraction && !showStreamingBubble) items.push({ id: 'blocking', kind: 'blocking' })
  return items
}

function reuseMessageItem<TMessage extends ChatRenderMessage>(
  previousById: Map<string, ChatRenderItem<TMessage>>,
  message: TMessage,
): ChatRenderItem<TMessage> {
  const id = `msg:${message.id}`
  const previous = previousById.get(id)
  if (previous?.kind === 'message' && previous.message === message) return previous
  return { id, kind: 'message', message }
}

function reuseGroupItem<TMessage extends ChatRenderMessage>(
  previousById: Map<string, ChatRenderItem<TMessage>>,
  group: ChatTimelineGroup,
): ChatRenderItem<TMessage> {
  const id = `group:${group.id}`
  const previous = previousById.get(id)
  if (previous?.kind === 'group' && previous.group === group) return previous
  return { id, kind: 'group', group }
}
