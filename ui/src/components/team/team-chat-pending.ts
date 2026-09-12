import { applyTurnEntry, createEmptyTurn } from '../../stores/turn-blocks'
import type { MessageData, SessionEventData, StreamingMessage } from '../../stores/session-events'
import type { Snapshot } from './team-chat-state'

const pendingId = (humanMessageId: string): string => `pending-team-${humanMessageId}`

export function isPendingTeamTurn(turn?: StreamingMessage | null): boolean {
  return !!turn?.id.startsWith('pending-team-')
}

export function pendingTeamPromptAnswered(turn: StreamingMessage | null | undefined, messages: MessageData[], events: SessionEventData[]): boolean {
  if (!isPendingTeamTurn(turn)) return false
  const humanId = turn!.id.slice('pending-team-'.length)
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence)
  const human = ordered.find(event => event.type === 'message.user' && matchesEventMessage(humanId, event))
  if (!human) return false
  // A batch persists its human inputs before prompt_received names the actual
  // reply. Turn clocks can start before persistence, so timestamps cannot link them.
  const reply = ordered.find(event => event.sequence > human.sequence && event.type === 'lifecycle.prompt_received')
  return !!reply && messages.some(message => message.role === 'agent' && matchesEventMessage(message.id, reply))
}

function matchesEventMessage(messageId: string, event: SessionEventData): boolean {
  return !!event.message_id && (messageId === event.message_id || messageId === `${event.session_id}:${event.message_id}`)
}

export function beginTeamPrompt(snapshot: Snapshot, message: MessageData): Snapshot {
  const busy = snapshot.running || !!(snapshot.streaming && !snapshot.streaming.done)
  return {
    ...snapshot,
    messages: [...snapshot.messages, message],
    running: true,
    streaming: busy ? snapshot.streaming : {
      ...applyTurnEntry(createEmptyTurn(pendingId(message.id)), { kind: 'stage', text: '正在准备 Agent...' }),
      startedAt: message.timestamp,
      senderName: snapshot.senderName || 'Master',
    },
  }
}

export function rejectTeamPrompt(snapshot: Snapshot, humanMessageId: string): Snapshot {
  const ownsPending = snapshot.streaming?.id === pendingId(humanMessageId)
  return {
    ...snapshot,
    messages: snapshot.messages.filter(message => message.id !== humanMessageId),
    streaming: ownsPending ? null : snapshot.streaming,
    running: ownsPending ? false : snapshot.running,
  }
}
