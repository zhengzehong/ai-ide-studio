import type {
  QueryPage,
  QueryPort,
  SessionEventQuery,
  SessionListQuery,
  SessionMessageQuery,
  SessionRecoveryQuery,
  SessionRecoverySnapshot,
  TaskListQuery,
} from '../ports/query-port.js'
import {
  eventStore,
  messageStore,
  sessionStore,
  type MessageRow,
  type SessionEventRow,
} from '../store/sessions.js'
import { listTaskReadModel } from './task-list-query.js'

const DEFAULT_MESSAGE_LIMIT = 100
const MAX_MESSAGE_LIMIT = 200
const DEFAULT_EVENT_LIMIT = 500
const MAX_EVENT_LIMIT = 1000

export interface DatabaseQueryPortOptions {
  isPromptActive?: (sessionId: string) => boolean
}

export function createDatabaseQueryPort(options: DatabaseQueryPortOptions = {}): QueryPort {
  const fallbackPromptActive = options.isPromptActive ?? (() => false)
  return {
    async listTasks(input: TaskListQuery) {
      return listTaskReadModel(input)
    },

    async listSessions(input: SessionListQuery) {
      const activePromptIds = input.activePromptSessionIds
        ? new Set(input.activePromptSessionIds)
        : undefined
      const isPromptActive = activePromptIds
        ? (sessionId: string) => activePromptIds.has(sessionId)
        : fallbackPromptActive
      return sessionStore.listWithRuntimeState(input.agentId, input.projectId, isPromptActive)
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
      return {
        sessionId: input.sessionId,
        latestSequence: eventStore.latestSequence(input.sessionId),
        events: eventStore.listRecovery(input.sessionId, limit),
      }
    },
  }
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(1, Math.floor(value)))
}
