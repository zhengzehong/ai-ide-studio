import { applyTurnEntry, createEmptyTurn } from '../../stores/turn-blocks'
import type { MessageData, StreamingMessage } from '../../stores/session-events'
import type { Snapshot } from './team-chat-state'

const pendingId = (humanMessageId: string): string => `pending-team-${humanMessageId}`

export function isPendingTeamTurn(turn?: StreamingMessage | null): boolean {
  return !!turn?.id.startsWith('pending-team-')
}

export function pendingTeamPromptAnswered(turn: StreamingMessage | null | undefined, messages: MessageData[]): boolean {
  if (!isPendingTeamTurn(turn)) return false
  const humanId = turn!.id.slice('pending-team-'.length)
  const human = messages.find(message => message.id === humanId)
  // Compare persisted timestamps on the same server, never server time against the client's clock.
  return !!human && messages.some(message => message.role === 'agent' && Date.parse(message.started_at || message.timestamp) >= Date.parse(human.timestamp))
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
