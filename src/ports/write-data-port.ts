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

export interface TurnProcessItemWriteInput {
  id: string
  sessionId: string
  messageId: string
  kind: string
  status?: string | null
  title?: string | null
  summary?: string | null
  preview?: string | null
  content?: string | null
  detail?: unknown
  meta?: unknown
}

export interface TurnProcessTextAppendInput {
  id: string
  sessionId: string
  messageId: string
  kind: 'thinking' | 'note' | 'stage' | 'error'
  text: string
  status?: string | null
  title?: string | null
  meta?: unknown
}

export interface TurnProcessItemWriteResult {
  id: string
  session_id: string
  message_id: string
  sequence: number
  kind: string
  status: string | null
  title: string | null
  summary: string | null
  preview: string | null
  content: string | null
  detail_json: string | null
  meta_json: string | null
  created_at: string
  updated_at: string
}

export interface SessionTurnFinalizeInput {
  sessionId: string
  messageId: string
  processStatus: string
  content: string
  status: string
  timestamp: string
  decisionJson?: string | null
  statsJson?: string | null
  fileChangesJson?: string | null
  presentationsJson?: string | null
}

export interface SessionTurnFinalizeResult {
  messageId: string
  fileChangesJson: string | null
  processItemCount: number
  /**
   * 终态是否真正写入。false = 行已存在且非 running(写入侧 `AND status='running'` 守卫拦截),
   * 调用方必须留痕,不得静默吞掉迟到的真终稿(2026-09-17 sess-d83044f2 事故)。
   */
  applied: boolean
}

export type WriteMutation =
  | { type: 'session.event.append'; event: SessionEventWriteInput }
  | { type: 'message.snapshot.update'; messageId: string; content: string; timestamp: string }
  | { type: 'session.touch'; sessionId: string; timestamp: string; advanceRead?: boolean }
  | { type: 'session.stage.update'; sessionId: string; stage: string; timestamp: string }
  | { type: 'session.stage.clear-running'; sessionId: string; timestamp: string }
  | { type: 'session.title.update-if-empty'; sessionId: string; title: string; timestamp: string }
  | { type: 'outbox.enqueue'; event: OutboxEventInput }
  | { type: 'turn-process.item.upsert'; item: TurnProcessItemWriteInput }
  | { type: 'turn-process.text.append'; item: TurnProcessTextAppendInput }
  | { type: 'session.turn.finalize'; input: SessionTurnFinalizeInput }

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
  | { type: 'session.stage.clear-running'; changes: number }
  | { type: 'session.title.update-if-empty'; changes: number }
  | { type: 'outbox.enqueue'; id: string }
  | { type: 'turn-process.item.upsert'; item: TurnProcessItemWriteResult }
  | { type: 'turn-process.text.append'; item: TurnProcessItemWriteResult }
  | { type: 'session.turn.finalize'; result: SessionTurnFinalizeResult }

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
  | 'session.forceFinish'
  | 'sessions.markRead'
  | 'sessions.markUnread'
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

export interface RuntimeCommandRecoveryCursor {
  createdAt: string
  commandId: string
}

export interface RuntimeCommandRecoveryQuery {
  limit: number
  after?: RuntimeCommandRecoveryCursor
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
  /** 按保留窗口清理的 writer_batch_commits 行数(幂等账本,去重只需分钟级历史)。 */
  deletedBatchCommitRows: number
  /** 本轮达到单次清理上限,剩余行留给下一轮(避免 maintenance 长时间占住写通道)。 */
  batchCommitPruneExhausted: boolean
  /** 各阶段耗时,供定位"maintenance 是否在拖慢写通道"。 */
  phasesMs: {
    outboxDeleteMs: number
    batchCommitPruneMs: number
    optimizeMs: number
    checkpointMs: number
  }
  elapsedMs: number
}

export interface DatabaseMaintenanceConfig {
  walCheckpointBytes?: number
  publishedOutboxRetentionMs?: number
  /** writer_batch_commits 保留窗口(默认 7 天)。 */
  batchCommitRetentionMs?: number
  /** 单次 maintenance 最多清理的 writer_batch_commits 行数(默认 5000)。 */
  batchCommitPruneRows?: number
  /** 单次 maintenance 最多删除的 outbox 行数(默认 20000)。 */
  outboxDeleteRows?: number
  /** PRAGMA optimize 的 analysis_limit(默认 4000,限制 ANALYZE 规模)。 */
  optimizeAnalysisLimit?: number
}

export interface RetentionInspectInput {
  cutoff: string
  keepTurns: number
}

export interface RetentionBatchInput extends RetentionInspectInput {
  batchRows: number
}

export interface RetentionInspectResult {
  eligibleMessages: number
  processRows: number
  eventRows: number
  estimatedBytes: number
}

export interface RetentionBatchResult {
  messageId: string | null
  resetProcessItemCount: boolean
  deletedProcessRows: number
  deletedEventRows: number
  hasMore: boolean
  elapsedMs: number
}

export interface WriteDataPort {
  commitBatch(batch: WriteBatch): Promise<WriteBatchResult>
  sessionCursor(sessionId: string): Promise<SessionWriteCursor>
  enqueueRuntimeCommand(input: RuntimeCommandInput): Promise<RuntimeCommandEnqueueResult>
  listRecoverableRuntimeCommands(input: RuntimeCommandRecoveryQuery): Promise<RuntimeCommandRecord[]>
  updateRuntimeCommand(input: RuntimeCommandUpdate): Promise<RuntimeCommandRecord>
  maintain(input: DatabaseMaintenanceInput): Promise<DatabaseMaintenanceResult>
  inspectRetention(input: RetentionInspectInput): Promise<RetentionInspectResult>
  runRetentionBatch(input: RetentionBatchInput): Promise<RetentionBatchResult>
  drain(): Promise<void>
  close(): Promise<void>
}
