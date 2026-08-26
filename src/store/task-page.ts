import { getDb } from './db.js'
import type { TaskRow } from './tasks.js'

export interface TaskPageRowQuery {
  projectId?: string
  status?: string
  query?: string
  createdFrom?: string
  createdBefore?: string
  excludeTerminal?: boolean
  cursor?: string
  limit: number
}

export interface TaskPageRows {
  items: TaskRow[]
  total: number
}

export class InvalidTaskCursorError extends Error {
  constructor() {
    super('Invalid task cursor')
    this.name = 'InvalidTaskCursorError'
  }
}

export function listTaskPageRows(input: TaskPageRowQuery): TaskPageRows {
  const db = getDb()
  const conditions: string[] = []
  const params: Record<string, string | number> = { limit: input.limit + 1 }

  if (input.projectId) {
    conditions.push('project_id = @projectId')
    params.projectId = input.projectId
  }
  if (input.status) {
    conditions.push('status = @status')
    params.status = input.status
  }
  if (input.excludeTerminal) conditions.push("status NOT IN ('completed', 'cancelled')")
  if (input.createdFrom) {
    conditions.push('created_at >= @createdFrom')
    params.createdFrom = input.createdFrom
  }
  if (input.createdBefore) {
    conditions.push('created_at < @createdBefore')
    params.createdBefore = input.createdBefore
  }
  const query = input.query?.trim().toLowerCase()
  if (query) {
    conditions.push('(instr(lower(id), @query) > 0 OR instr(lower(title), @query) > 0)')
    params.query = query
  }

  const countWhere = whereClause(conditions)
  const total = db
    .prepare<Record<string, string | number>, { total: number }>(`SELECT COUNT(*) AS total FROM tasks${countWhere}`)
    .get(params)?.total ?? 0

  if (input.cursor) {
    params.cursorLookupId = input.cursor
    const anchor = db
      .prepare<Record<string, string | number>, Pick<TaskRow, 'id' | 'created_at' | 'project_id'>>(
        `SELECT id, created_at, project_id FROM tasks${whereClause([...conditions, 'id = @cursorLookupId'])}`,
      )
      .get(params)
    if (!anchor) throw new InvalidTaskCursorError()
    conditions.push('(created_at < @cursorCreatedAt OR (created_at = @cursorCreatedAt AND id < @cursorId))')
    params.cursorCreatedAt = anchor.created_at
    params.cursorId = anchor.id
  }

  const items = db
    .prepare<Record<string, string | number>, TaskRow>(
      `SELECT * FROM tasks${whereClause(conditions)} ORDER BY created_at DESC, id DESC LIMIT @limit`,
    )
    .all(params)

  return { items, total }
}

function whereClause(conditions: string[]): string {
  return conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
}
