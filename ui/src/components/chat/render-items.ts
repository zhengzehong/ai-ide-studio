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
  messages,
  events,
  streamingBubble,
  showStreamingBubble,
  blockingInteraction,
  timelineEventLimit = 1000,
}: {
  messages: TMessage[]
  events: SessionEventData[]
  streamingBubble: TMessage | null
  showStreamingBubble: boolean
  blockingInteraction: boolean
  timelineEventLimit?: number
}): ChatRenderItem<TMessage>[] {
  const timelineGroups = groupChatTimelineItems(buildChatTimelineFromEvents(events))
  const timelineFallbackMessages =
    timelineGroups.length > 0 && events.length >= timelineEventLimit
      ? messages.filter((message) => isBeforeTimeline(message, timelineGroups[0].timestamp))
      : []
  const items: ChatRenderItem<TMessage>[] =
    timelineGroups.length > 0
      ? [
          ...timelineFallbackMessages.map((message) => ({ id: `msg:${message.id}`, kind: 'message' as const, message })),
          ...timelineGroups.map((group) => ({ id: `group:${group.id}`, kind: 'group' as const, group })),
        ]
      : messages.map((message) => ({ id: `msg:${message.id}`, kind: 'message', message }))

  if (showStreamingBubble && streamingBubble && timelineGroups.length === 0) {
    items.push({ id: 'streaming', kind: 'streaming', message: streamingBubble })
  }
  if (blockingInteraction && !showStreamingBubble) items.push({ id: 'blocking', kind: 'blocking' })
  return items
}

function isBeforeTimeline(message: ChatRenderMessage, firstTimelineAt: string): boolean {
  const messageTime = Date.parse(message.timestamp || '')
  const timelineTime = Date.parse(firstTimelineAt)
  return Number.isFinite(messageTime) && Number.isFinite(timelineTime) && messageTime < timelineTime
}
