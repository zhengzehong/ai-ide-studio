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

export type RuntimeCommandType =
  | 'prompt'
  | 'session.cancel'
  | 'sessions.markRead'
  | 'permission.respond'
  | 'elicitation.respond'

export type RuntimeCommandStatus = 'accepted' | 'running' | 'completed' | 'failed' | 'interrupted'

export interface RuntimeCommandInput {
  commandId: string
  idempotencyKey: string
  type: RuntimeCommandType
  sessionId: string
  projectId?: string
  payload: unknown
  createdAt: string
}

export interface RuntimeCommandRecord extends RuntimeCommandInput {
  status: RuntimeCommandStatus
  attempts: number
  updatedAt: string
  error?: string
  humanMessagePersisted: boolean
}

export interface RuntimeCommandEnqueueResult {
  command: RuntimeCommandRecord
  duplicate: boolean
  conflict: boolean
}

export interface RuntimeCommandUpdate {
  commandId: string
  status: Exclude<RuntimeCommandStatus, 'accepted'>
  updatedAt: string
  error?: string
}

export interface DatabaseMaintenanceInput {
  force: boolean
}

export type DatabaseCheckpointMode = 'none' | 'passive' | 'truncate'

export interface DatabaseMaintenanceResult {
  walBytesBefore: number
  walBytesAfter: number
  checkpointAttempted: boolean
  checkpointMode: DatabaseCheckpointMode
  checkpointBusyPages: number
  checkpointLogPages: number
  checkpointedPages: number
  optimized: boolean
  deletedPublishedOutboxRows: number
  elapsedMs: number
}

export interface DatabaseMaintenanceConfig {
  walCheckpointBytes?: number
  publishedOutboxRetentionMs?: number
}

export interface WriteDataPort {
  commitBatch(batch: WriteBatch): Promise<WriteBatchResult>
  sessionCursor(sessionId: string): Promise<SessionWriteCursor>
  enqueueRuntimeCommand(input: RuntimeCommandInput): Promise<RuntimeCommandEnqueueResult>
  listRecoverableRuntimeCommands(limit: number): Promise<RuntimeCommandRecord[]>
  updateRuntimeCommand(input: RuntimeCommandUpdate): Promise<RuntimeCommandRecord>
  maintain(input: DatabaseMaintenanceInput): Promise<DatabaseMaintenanceResult>
  drain(): Promise<void>
  close(): Promise<void>
}
