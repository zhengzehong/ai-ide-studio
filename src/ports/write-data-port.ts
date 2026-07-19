import type { WritePriority } from '../data-worker/protocol.js'

export interface SessionEventWriteInput {
  id: string
  sessionId: string
  agentId?: string
  acpSessionId?: string
  messageId?: string
  eventType: string
  role?: string
  payload: unknown
  createdAt: string
}

export interface OutboxEventInput {
  id: string
  topic: string
  aggregateType: string
  aggregateId: string
  projectId?: string
  sessionId?: string
  version?: number
  payload: unknown
  createdAt: string
}

export type WriteMutation =
  | { type: 'session.event.append'; event: SessionEventWriteInput }
  | { type: 'message.snapshot.update'; messageId: string; content: string; timestamp: string }
  | { type: 'session.touch'; sessionId: string; timestamp: string }
  | { type: 'session.stage.update'; sessionId: string; stage: string; timestamp: string }
  | { type: 'outbox.enqueue'; event: OutboxEventInput }

export interface WriteBatch {
  batchId: string
  priority: WritePriority
  sessionId?: string
  streamGeneration?: string
  firstSequence?: number
  lastSequence?: number
  mutations: WriteMutation[]
  deadlineMs?: number
}

export interface SessionEventWriteResult {
  id: string
  session_id: string
  agent_id: string | null
  acp_session_id: string | null
  message_id: string | null
  type: string
  role: string | null
  payload_json: string
  sequence: number
  created_at: string
}

export type WriteMutationResult =
  | { type: 'session.event.append'; event: SessionEventWriteResult }
  | { type: 'message.snapshot.update'; changes: number }
  | { type: 'session.touch'; changes: number }
  | { type: 'session.stage.update'; changes: number }
  | { type: 'outbox.enqueue'; id: string }

export interface WriteBatchResult {
  batchId: string
  duplicate: boolean
  committedAt: string
  results: WriteMutationResult[]
}

export interface SessionWriteCursor {
  sequence: number
}

export interface WriteDataPort {
  commitBatch(batch: WriteBatch): Promise<WriteBatchResult>
  sessionCursor(sessionId: string): Promise<SessionWriteCursor>
  drain(): Promise<void>
  close(): Promise<void>
}
