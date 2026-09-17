import type {
  QueryPage,
  QueryPort,
  SessionEventQuery,
  SessionListQuery,
  SessionMessageQuery,
  SessionRecoveryQuery,
  SessionRecoverySnapshot,
  TeamMemberStateQuery,
  TeamMemberStateSnapshot,
  TaskListQuery,
  TaskPageQuery,
  WidgetSessionListQuery,
} from '../ports/query-port.js'
import {
  eventStore,
  messageStore,
  sessionStore,
  type MessageRow,
  type SessionEventRow,
} from '../store/sessions.js'
import { listTaskPageReadModel, listTaskReadModel } from './task-list-query.js'
import { listWidgetSessionReadModel } from './widget-session-list-query.js'
import { readSessionRecovery } from './session-recovery-query.js'
import { readTeamMemberState } from './team-member-state-query.js'
import { createChildLogger } from '../core/logger.js'

const DEFAULT_MESSAGE_LIMIT = 100
const MAX_MESSAGE_LIMIT = 200
const DEFAULT_EVENT_LIMIT = 500
const MAX_EVENT_LIMIT = 1000
const SLOW_RECOVERY_QUERY_MS = 100
const log = createChildLogger('query:session-recovery')

export interface DatabaseQueryPortOptions {
  isPromptActive?: (sessionId: string) => boolean
}

export function createDatabaseQueryPort(options: DatabaseQueryPortOptions = {}): QueryPort {
  const fallbackPromptActive = options.isPromptActive ?? (() => false)
  return {
    async listTasks(input: TaskListQuery) {
      return listTaskReadModel(input)
    },

    async listTaskPage(input: TaskPageQuery) {
      return listTaskPageReadModel(input)
    },

    async listSessions(input: SessionListQuery) {
      const activePromptIds = input.activePromptSessionIds
        ? new Set(input.activePromptSessionIds)
        : undefined
      const isPromptActive = activePromptIds
        ? (sessionId: string) => activePromptIds.has(sessionId)
        : fallbackPromptActive
      return sessionStore.listWithRuntimeState(input.agentId, input.projectId, isPromptActive, { userVisibleOnly: true })
    },

    async listSessionMessages(input: SessionMessageQuery): Promise<QueryPage<MessageRow>> {
      const limit = boundedLimit(input.limit, DEFAULT_MESSAGE_LIMIT, MAX_MESSAGE_LIMIT)
      const rows = messageStore.list(input.sessionId, {
        limit: limit + 1,
        before: input.before,
        includeToolCalls: input.includeToolCalls,
        includeLatestToolCalls: input.includeLatestToolCalls,
      })
      const hasMore = rows.length > limit
      const items = hasMore ? rows.slice(1) : rows
      return {
        items,
        hasMore,
        nextCursor: hasMore ? (items[0]?.timestamp ?? null) : null,
      }
    },

    async listSessionEvents(input: SessionEventQuery): Promise<QueryPage<SessionEventRow>> {
      const limit = boundedLimit(input.limit, DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT)
      const rows = eventStore.list(input.sessionId, {
        limit: limit + 1,
        afterSequence: input.afterSequence,
      })
      const hasMore = rows.length > limit
      const items = input.afterSequence == null
        ? (hasMore ? rows.slice(1) : rows)
        : rows.slice(0, limit)
      const cursorEvent = input.afterSequence == null ? items[0] : items.at(-1)
      return {
        items,
        hasMore,
        nextCursor: hasMore && cursorEvent ? String(cursorEvent.sequence) : null,
      }
    },

    async getSessionRecovery(input: SessionRecoveryQuery): Promise<SessionRecoverySnapshot> {
      const limit = boundedLimit(input.limit, DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT)
      const result = readSessionRecovery({ ...input, limit })
      if (result.diagnostics.totalMs >= SLOW_RECOVERY_QUERY_MS) {
        log.warn(result.diagnostics, 'slow session recovery query completed')
      } else {
        log.debug(result.diagnostics, 'session recovery query completed')
      }
      return result.snapshot
    },

    /**
     * 团队面板轻量恢复(P1):尾巴扫描 + 未决项候选,不搬历史事件。
     * 诊断日志与 recovery 同款(>100ms 记 warn),便于对照两条路径的真实成本。
     */
    async getTeamMemberState(input: TeamMemberStateQuery): Promise<TeamMemberStateSnapshot> {
      const result = readTeamMemberState(input)
      if (result.diagnostics.totalMs >= SLOW_RECOVERY_QUERY_MS) {
        log.warn(result.diagnostics, 'slow team member state query completed')
      } else {
        log.debug(result.diagnostics, 'team member state query completed')
      }
      return result.snapshot
    },

    async listWidgetSessions(input: WidgetSessionListQuery) {
      return listWidgetSessionReadModel(input, fallbackPromptActive)
    },
  }
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(1, Math.floor(value)))
}
