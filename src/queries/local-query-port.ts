import type {
  QueryPage,
  QueryPort,
  SessionEventQuery,
  SessionListQuery,
  SessionMessageQuery,
  TaskListQuery,
} from '../ports/query-port.js'
import { sessionManager } from '../core/sessions.js'
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

export interface LocalQueryPortOptions {
  isPromptActive?: (sessionId: string) => boolean
}

export function createLocalQueryPort(options: LocalQueryPortOptions = {}): QueryPort {
  const isPromptActive = options.isPromptActive ?? ((sessionId: string) => sessionManager.isPromptActive(sessionId))
  return {
    async listTasks(input: TaskListQuery) {
      return listTaskReadModel(input)
    },

    async listSessions(input: SessionListQuery) {
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
  }
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(1, Math.floor(value)))
}

export const localQueryPort: QueryPort = createLocalQueryPort()
