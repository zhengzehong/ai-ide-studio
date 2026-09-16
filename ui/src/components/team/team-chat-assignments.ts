import type { MessageData, SessionEventData, StreamingMessage, TeamAssignmentInfo } from '../../stores/session-events'

const LEGACY_ASSIGNMENT_MARKER = 'Leader 派发内容：'

/** Keep source sender metadata while normalizing a message for the shared pane. */
export function mapTeamMessage(
  message: MessageData,
  sourceSessionId: string,
  targetSessionId: string,
  senderName: string,
  senderRole: string,
): MessageData {
  const displayId = `${sourceSessionId}:${message.id}`
  const isAgent = message.role === 'agent'
  return {
    ...message,
    id: displayId,
    session_id: targetSessionId,
    sender_name: isAgent ? senderName : message.sender_name,
    sender_role: isAgent ? senderRole : message.sender_role ?? (message.role === 'human' ? 'user' : senderRole),
  }
}

/** Remove dispatch prompts from the chat stream and attach them to the next member reply. */
export function attachTeamAssignments(
  messages: MessageData[],
  streaming: StreamingMessage | null = null,
): { messages: MessageData[]; streaming: StreamingMessage | null } {
  const grouped = new Map<string, MessageData[]>()
  messages.forEach((message) => {
    const source = sourceIdOf(message)
    grouped.set(source, [...(grouped.get(source) || []), message])
  })
  const result: MessageData[] = []
  let pendingForStreaming: TeamAssignmentInfo | null = null
  for (const sourceMessages of grouped.values()) {
    let pending: TeamAssignmentInfo | null = null
    for (const message of sourceMessages.sort(compareMessages)) {
      const assignment = assignmentFromMessage(message)
      if (assignment) { pending = assignment; continue }
      if (pending && message.role === 'agent' && !message.teamAssignment) { result.push({ ...message, teamAssignment: pending }); pending = null; continue }
      result.push(message)
    }
    pendingForStreaming = pending || pendingForStreaming
  }
  result.sort(compareMessages)
  return {
    messages: result,
    streaming: pendingForStreaming && streaming && !streaming.teamAssignment
      ? { ...streaming, teamAssignment: pendingForStreaming }
      : streaming,
  }
}

export function findPendingTeamAssignment(messages: MessageData[]): TeamAssignmentInfo | null {
  let pending: TeamAssignmentInfo | null = null
  for (const message of [...messages].sort(compareMessages)) {
    const assignment = assignmentFromMessage(message)
    if (assignment) {
      pending = assignment
      continue
    }
    if (message.role === 'agent') pending = null
  }
  return pending
}

export function assignmentFromEvent(event: SessionEventData): TeamAssignmentInfo | null {
  if (event.type !== 'message.user') return null
  try {
    const payload = JSON.parse(event.payload_json) as Record<string, unknown>
    if (payload.senderRole !== 'team-assignment') return null
    const content = typeof payload.content === 'string' ? payload.content.trim() : ''
    if (!content) return null
    return { content, fromName: typeof payload.senderName === 'string' && payload.senderName.trim() ? payload.senderName.trim() : 'Master' }
  } catch {
    return null
  }
}

function assignmentFromMessage(message: MessageData): TeamAssignmentInfo | null {
  if (message.role !== 'human') return null
  // 定向消息（你在团队线里直接发给某成员）不并入"派发块"：就地留在消息流里渲染（见 decorateDirectedMessages）。
  if (message.sender_role === 'team-directed') return null
  if (message.sender_role === 'team-assignment') {
    const content = message.content.trim()
    return content ? { content, fromName: message.sender_name?.trim() || 'Master' } : null
  }
  const markerIndex = message.content.indexOf(LEGACY_ASSIGNMENT_MARKER)
  if (markerIndex < 0) return null
  const content = message.content.slice(markerIndex + LEGACY_ASSIGNMENT_MARKER.length).trim()
  if (!content) return null
  const taskMatch = message.content.match(/Task:\s*([^\n]+)/)
  return { content, fromName: message.sender_name?.trim() || 'Master', taskId: taskMatch?.[1]?.trim() }
}

/**
 * 定向消息聚合层装饰：把 `sender_role === 'team-directed'` 的人类消息就地转成「你 → 成员」转录块 + 状态徽标：
 * - 目标成员名：该来源会话里 agent 消息的署名（与成员行一致）；
 * - 徽标：成员会话正在跑 → 执行中；其后再无该成员回合且已有回复 → 已完成；尚未起跑 → 排队中 · 等待空闲。
 * 只做展示层推导，不改后端排队语义（真实排队由 dispatchMemberPrompt 的 FIFO 保证）。
 */
export function decorateDirectedMessages(
  messages: MessageData[],
  runningSessionIds: Record<string, boolean | undefined> = {},
): MessageData[] {
  const directed = messages.filter((message) => message.role === 'human' && message.sender_role === 'team-directed')
  if (directed.length === 0) return messages
  const memberNameBySource = new Map<string, string>()
  const lastAgentAtBySource = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== 'agent') continue
    const source = sourceIdOf(message)
    if (message.sender_name?.trim()) memberNameBySource.set(source, message.sender_name.trim())
    const previous = lastAgentAtBySource.get(source)
    if (!previous || previous < message.timestamp) lastAgentAtBySource.set(source, message.timestamp)
  }
  return messages.map((message) => {
    if (message.role !== 'human' || message.sender_role !== 'team-directed') return message
    const source = sourceIdOf(message)
    const running = runningSessionIds[source] === true
    const repliedAfter = (lastAgentAtBySource.get(source) || '') > message.timestamp
    const badge: TeamAssignmentInfo['badge'] = running ? 'running' : repliedAfter ? 'done' : 'queued'
    return {
      ...message,
      teamAssignment: {
        content: message.content,
        fromName: '你',
        directed: true,
        targetName: memberNameBySource.get(source) || message.sender_name?.trim() || '成员',
        badge,
      },
    }
  })
}

function compareMessages(left: MessageData, right: MessageData): number {
  return left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id)
}

function sourceIdOf(message: MessageData): string {
  const separator = message.id.indexOf(':')
  return separator > 0 ? message.id.slice(0, separator) : message.session_id
}
