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
  const timelineGroups = groupChatTimelineItems(buildChatTimelineFromEvents(scopedEvents.slice(-timelineEventLimit)))
  const timelineMessageIds = collectTimelineMessageIds(timelineGroups)
  const items: ChatRenderItem<TMessage>[] =
    timelineGroups.length > 0
      ? sortTimedItems([
          ...scopedMessages
            .filter((message) => !isMessageRepresentedByTimeline(message, timelineGroups, timelineMessageIds))
            .map((message) => ({ item: { id: `msg:${message.id}`, kind: 'message' as const, message }, timestamp: message.timestamp })),
          ...timelineGroups.map((group) => ({ item: { id: `group:${group.id}`, kind: 'group' as const, group }, timestamp: group.timestamp })),
        ])
      : scopedMessages.map((message) => ({ id: `msg:${message.id}`, kind: 'message', message }))

  if (
    showStreamingBubble &&
    scopedStreamingBubble &&
    !isMessageRepresentedByTimeline(scopedStreamingBubble, timelineGroups, timelineMessageIds)
  ) {
    items.push({ id: `streaming:${scopedStreamingBubble.id}`, kind: 'streaming', message: scopedStreamingBubble })
  }
  if (blockingInteraction && !showStreamingBubble) items.push({ id: 'blocking', kind: 'blocking' })
  return items
}

function collectTimelineMessageIds(timelineGroups: ChatTimelineGroup[]): Set<string> {
  const ids = new Set<string>()
  for (const group of timelineGroups) {
    if (group.messageId) ids.add(group.messageId)
    for (const block of group.blocks) {
      if (block.messageId) ids.add(block.messageId)
    }
  }
  return ids
}

function sortTimedItems<TMessage extends ChatRenderMessage>(
  items: { item: ChatRenderItem<TMessage>; timestamp?: string }[],
): ChatRenderItem<TMessage>[] {
  return items
    .map((entry, index) => ({ ...entry, index, time: parseTime(entry.timestamp) }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map((entry) => entry.item)
}

function parseTime(timestamp?: string): number {
  const time = Date.parse(timestamp || '')
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER
}

function isMessageRepresentedByTimeline(
  message: ChatRenderMessage,
  timelineGroups: ChatTimelineGroup[],
  timelineMessageIds: Set<string>,
): boolean {
  if (timelineMessageIds.has(message.id)) return true
  return timelineGroups.some((group) => timelineGroupMatchesMessage(group, message))
}

function timelineGroupMatchesMessage(group: ChatTimelineGroup, message: ChatRenderMessage): boolean {
  if (group.role !== message.role) return false
  const groupText = group.blocks
    .filter((block) => block.kind === 'message')
    .map((block) => block.content)
    .join('')
    .trim()
  const messageText = (message.content || '').trim()
  const groupThinking = group.blocks
    .filter((block) => block.kind === 'message')
    .map((block) => block.thinking || '')
    .join('')
    .trim()
  const messageThinking = (message.thinking || '').trim()

  if (messageText && groupText === messageText) return true
  if (messageThinking && groupThinking === messageThinking) return true
  if (message.id.startsWith('msg-local-') && groupText && groupText === messageText) return true

  const groupToolCount = group.blocks.filter((block) => block.kind === 'tool').length
  const messageToolCount = message.tool_call_count ?? (message.tool_calls_json ? 1 : 0)
  return message.role === 'agent' && groupToolCount > 0 && messageToolCount > 0 && (!messageText || !groupText)
}
