import type { MessageData } from '@desktop/stores/session-events'

interface DeriveLiveElapsedInput {
  isRunning: boolean
  sessionId: string | null | undefined
  nowMs: number
  messages: Pick<MessageData, 'session_id' | 'role' | 'timestamp'>[]
}

export function deriveLiveElapsedSeconds(input: DeriveLiveElapsedInput): number | undefined {
  if (!input.isRunning || !input.sessionId) return undefined
  for (let i = input.messages.length - 1; i >= 0; i -= 1) {
    const message = input.messages[i]
    if (message.session_id !== input.sessionId || message.role !== 'human') continue
    const timestamp = Date.parse(message.timestamp)
    if (!Number.isFinite(timestamp)) return undefined
    return Math.max(0, Math.floor((input.nowMs - timestamp) / 1000))
  }
  return undefined
}
