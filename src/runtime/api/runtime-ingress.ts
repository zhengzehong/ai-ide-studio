import { events } from '../../core/events.js'
import { sessionManager } from '../../core/sessions.js'
import { applyRuntimeAgentStatus } from '../../core/agent-runtime-status.js'
import type { SessionActivityReason, SessionStopReason, SessionUpdateData } from '../../types/ws-protocol.js'
import type { RuntimeAgentStatusEvent, RuntimeDoneEvent, RuntimePersistenceUpdate } from '../service/protocol.js'
import { isAutonomousTurnMessageId } from '../../shared/autonomous-turn.js'
import {
  drainPlatformPresentationResults,
  reconcilePlatformPresentationUpdate,
} from '../../core/platform-presentation-results.js'

export function handleRuntimeAgentStatus(event: RuntimeAgentStatusEvent): void {
  applyRuntimeAgentStatus(event)
}

export async function handleRuntimePersistenceUpdate(event: RuntimePersistenceUpdate): Promise<void> {
  const reconciled = reconcilePlatformPresentationUpdate(event.sessionId, updateData(event))
  events.emit('session:update', {
    sessionId: event.sessionId,
    agentId: event.agentId,
    data: reconciled.data,
    source: reconciled.matched ? 'platform-reconciliation' : 'runtime-persistence',
    streamGeneration: event.streamGeneration,
    sequence: event.sequence,
  })
}

export async function handleRuntimeDone(event: RuntimeDoneEvent): Promise<void> {
  for (const data of drainPlatformPresentationResults(event.sessionId, event.messageId)) {
    events.emit('session:update', {
      sessionId: event.sessionId,
      agentId: event.agentId,
      data,
      source: 'platform-synthetic',
      streamGeneration: event.streamGeneration,
      sequence: event.sequence,
    })
  }
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
  // 自治回合的合成 done:补发核心总线的 idle 活动——runtime 侧的 session:activity
  // 只走 realtime 流(客户端可见),core 总线这条供 team-member-dispatcher(队列续跑)
  // 与 team-wake-coordinator(Leader 唤醒恢复)使用;source 标记避免总线再重复广播客户端。
  if (isAutonomousTurnMessageId(event.messageId)) {
    events.emit('session:activity', {
      sessionId: event.sessionId,
      agentId: event.agentId,
      state: 'idle',
      reason: autonomousActivityReason(stopReason(event.stopReason)),
      timestamp: new Date().toISOString(),
      source: 'runtime',
    })
  }
}

function autonomousActivityReason(reason: SessionStopReason | undefined): SessionActivityReason {
  if (reason === 'cancelled') return 'autonomous-cancelled'
  if (reason === 'error') return 'autonomous-error'
  return 'autonomous-done'
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
