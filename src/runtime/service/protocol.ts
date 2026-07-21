import type { RuntimeStateSnapshot } from '../../ports/runtime-port.js'
import type { AgentStatus, SessionCapabilities, ServerMessage } from '../../types/ws-protocol.js'
import type { TurnUsageData } from '../../types/ws-protocol.js'
import type { RuntimeCoalescibleUpdate } from '../streams/runtime-update-coalescer.js'

export interface RuntimePersistenceUpdate {
  sessionId: string
  agentId: string
  update: RuntimeCoalescibleUpdate
  streamGeneration: string
  sequence: number
}

export interface RuntimeDoneEvent {
  sessionId: string
  agentId: string
  messageId: string
  stopReason?: string
  error?: string
  turnId?: string
  turnUsage?: TurnUsageData
  streamGeneration: string
  sequence: number
}

export interface RuntimeAgentStatusEvent {
  agentId: string
  status: AgentStatus
}

export type RuntimeCommand =
  | { operation: 'ensure'; snapshot: RuntimeStateSnapshot; emitLifecycle?: boolean }
  | { operation: 'prompt'; agentId: string; sessionId: string; content: string; images?: unknown[]; diagnostics?: { turnId?: string; messageId?: string } }
  | { operation: 'cancel'; agentId: string; sessionId: string }
  | { operation: 'close-session'; agentId: string; sessionId: string }
  | { operation: 'fork'; snapshot: RuntimeStateSnapshot; sourceAcpSessionId: string }
  | { operation: 'set-model'; agentId: string; sessionId: string; modelId: string }
  | { operation: 'set-mode'; agentId: string; sessionId: string; modeId: string }
  | { operation: 'set-config'; agentId: string; sessionId: string; configId: string; value: string | boolean }
  | { operation: 'capabilities'; agentId: string; sessionId: string }
  | { operation: 'permission'; sessionId: string; requestId: string; optionId?: string; cancelled?: boolean }
  | { operation: 'elicitation'; sessionId: string; requestId: string; action: 'accept' | 'decline' | 'cancel'; content?: Record<string, string | number | boolean | string[]> }
  | { operation: 'drain' }

export type RuntimeControlPayload =
  | { type: 'hello'; token: string }
  | { type: 'hello.ack' }
  | { type: 'ready' }
  | { type: 'request'; requestId: string; command: RuntimeCommand }
  | { type: 'result'; requestId: string; result?: unknown; error?: string }
  | { type: 'persistence'; event: RuntimePersistenceUpdate }
  | { type: 'done'; requestId: string; event: RuntimeDoneEvent }
  | { type: 'done.ack'; requestId: string; error?: string }
  | { type: 'agent-status'; event: RuntimeAgentStatusEvent }
  | { type: 'control'; operation: 'stop' }

export type RuntimeStreamPayload =
  | { type: 'runtime.hello'; token: string }
  | { type: 'runtime.hello.ack' }
  | { type: 'runtime.stream'; message: ServerMessage }

export function isRuntimeControlPayload(value: unknown): value is RuntimeControlPayload {
  return isRecordWithType(value)
}

export function isRuntimeStreamPayload(value: unknown): value is RuntimeStreamPayload {
  return isRecordWithType(value)
}

export function asSessionCapabilities(value: unknown): SessionCapabilities | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as SessionCapabilities
    : undefined
}

function isRecordWithType(value: unknown): value is { type: string } {
  return Boolean(value && typeof value === 'object' && typeof (value as Record<string, unknown>).type === 'string')
}
