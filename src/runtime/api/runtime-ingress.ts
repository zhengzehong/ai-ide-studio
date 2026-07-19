import { events } from '../../core/events.js'
import { sessionManager } from '../../core/sessions.js'
import type { SessionStopReason, SessionUpdateData } from '../../types/ws-protocol.js'
import type { RuntimeDoneEvent, RuntimePersistenceUpdate } from '../service/protocol.js'

export async function handleRuntimePersistenceUpdate(event: RuntimePersistenceUpdate): Promise<void> {
  events.emit('session:update', {
    sessionId: event.sessionId,
    agentId: event.agentId,
    data: updateData(event),
    source: 'runtime-persistence',
    streamGeneration: event.streamGeneration,
    sequence: event.sequence,
  })
}

export async function handleRuntimeDone(event: RuntimeDoneEvent): Promise<void> {
  events.emit('session:done', {
    sessionId: event.sessionId,
    agentId: event.agentId,
    messageId: event.messageId,
    turnId: event.turnId,
    turnUsage: event.turnUsage,
    stopReason: stopReason(event.stopReason),
    error: event.error,
    streamGeneration: event.streamGeneration,
    sequence: event.sequence,
  })
  await sessionManager.waitForPersistence(event.sessionId)
}

function updateData(event: RuntimePersistenceUpdate): SessionUpdateData {
  const nested = event.update.data
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return {
      ...nested as SessionUpdateData,
      ...(typeof event.update.contentDelta === 'string'
        ? { contentDelta: `${stringValue((nested as Record<string, unknown>).contentDelta)}${event.update.contentDelta}` }
        : {}),
    }
  }
  return {
    messageId: event.update.messageId,
    role: 'agent',
    ...(typeof event.update.contentDelta === 'string' ? { contentDelta: event.update.contentDelta } : {}),
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function stopReason(value: string | undefined): SessionStopReason | undefined {
  return value === 'end_turn'
    || value === 'max_tokens'
    || value === 'max_turn_requests'
    || value === 'refusal'
    || value === 'cancelled'
    || value === 'error'
    ? value
    : undefined
}
