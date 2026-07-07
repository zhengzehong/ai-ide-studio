import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export interface AgentMemoryEntryRow {
  id: string
  dimension_id: string
  title: string
  content: string
  tags: string
  source_session_id: string | null
  source_task_id: string | null
  confidence: number
  pinned: number
  inject_full: number
  last_used_at: string | null
  use_count: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface CreateAgentMemoryEntryInput {
  dimensionId: string
  title: string
  content: string
  tags?: string[]
  sourceSessionId?: string | null
  sourceTaskId?: string | null
  confidence?: number
  pinned?: boolean
  injectFull?: boolean
}

export interface UpdateAgentMemoryEntryInput {
  title?: string
  content?: string
  tags?: string[]
  confidence?: number
  pinned?: boolean
  injectFull?: boolean
}

export const agentMemoryEntryStore = {
  create(input: CreateAgentMemoryEntryInput): AgentMemoryEntryRow {
    const now = new Date().toISOString()
    const row: AgentMemoryEntryRow = {
      id: `ame-${randomUUID().slice(0, 8)}`,
      dimension_id: input.dimensionId,
      title: input.title,
      content: input.content,
      tags: JSON.stringify(input.tags ?? []),
      source_session_id: input.sourceSessionId ?? null,
      source_task_id: input.sourceTaskId ?? null,
      confidence: input.confidence ?? 1.0,
      pinned: input.pinned ? 1 : 0,
      inject_full: input.injectFull ? 1 : 0,
      last_used_at: null,
      use_count: 0,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }
    getDb().prepare(`
      INSERT INTO agent_memory_entries (
        id, dimension_id, title, content, tags,
        source_session_id, source_task_id, confidence, pinned, inject_full,
        last_used_at, use_count, created_at, updated_at, deleted_at
      )
      VALUES (
        @id, @dimension_id, @title, @content, @tags,
        @source_session_id, @source_task_id, @confidence, @pinned, @inject_full,
        @last_used_at, @use_count, @created_at, @updated_at, @deleted_at
      )
    `).run(row)
    return row
  },

  get(id: string): AgentMemoryEntryRow | undefined {
    return getDb()
      .prepare<[string], AgentMemoryEntryRow>(
        'SELECT * FROM agent_memory_entries WHERE id = ? AND deleted_at IS NULL',
      )
      .get(id)
  },

  listByDimension(dimensionId: string): AgentMemoryEntryRow[] {
    return getDb()
      .prepare<[string], AgentMemoryEntryRow>(`
        SELECT * FROM agent_memory_entries
        WHERE dimension_id = ? AND deleted_at IS NULL
        ORDER BY pinned DESC, inject_full DESC, use_count DESC, created_at DESC
      `)
      .all(dimensionId)
  },

  listPinnedByDimensions(dimensionIds: string[]): AgentMemoryEntryRow[] {
    if (dimensionIds.length === 0) return []
    const placeholders = dimensionIds.map(() => '?').join(',')
    return getDb()
      .prepare<string[], AgentMemoryEntryRow>(`
        SELECT * FROM agent_memory_entries
        WHERE deleted_at IS NULL AND pinned = 1 AND dimension_id IN (${placeholders})
        ORDER BY use_count DESC
      `)
      .all(...dimensionIds)
  },

  listInjectFullByDimensions(dimensionIds: string[], minConfidence: number, limit: number): AgentMemoryEntryRow[] {
    if (dimensionIds.length === 0) return []
    const placeholders = dimensionIds.map(() => '?').join(',')
    return getDb()
      .prepare<Array<string | number>, AgentMemoryEntryRow>(`
        SELECT * FROM agent_memory_entries
        WHERE deleted_at IS NULL
          AND pinned = 1
          AND inject_full = 1
          AND dimension_id IN (${placeholders})
          AND confidence >= ?
        ORDER BY use_count DESC
        LIMIT ?
      `)
      .all(...dimensionIds, minConfidence, limit)
  },

  countPinnedByDimensions(dimensionIds: string[]): number {
    if (dimensionIds.length === 0) return 0
    const placeholders = dimensionIds.map(() => '?').join(',')
    const row = getDb()
      .prepare<string[], { count: number }>(`
        SELECT COUNT(*) AS count FROM agent_memory_entries
        WHERE deleted_at IS NULL AND pinned = 1 AND dimension_id IN (${placeholders})
      `)
      .get(...dimensionIds)
    return row?.count ?? 0
  },

  countInjectFullByDimensions(dimensionIds: string[]): number {
    if (dimensionIds.length === 0) return 0
    const placeholders = dimensionIds.map(() => '?').join(',')
    const row = getDb()
      .prepare<string[], { count: number }>(`
        SELECT COUNT(*) AS count FROM agent_memory_entries
        WHERE deleted_at IS NULL AND pinned = 1 AND inject_full = 1 AND dimension_id IN (${placeholders})
      `)
      .get(...dimensionIds)
    return row?.count ?? 0
  },

  update(id: string, input: UpdateAgentMemoryEntryInput): AgentMemoryEntryRow | undefined {
    const current = agentMemoryEntryStore.get(id)
    if (!current) return undefined
    const next: AgentMemoryEntryRow = {
      ...current,
      title: input.title ?? current.title,
      content: input.content ?? current.content,
      tags: input.tags ? JSON.stringify(input.tags) : current.tags,
      confidence: input.confidence ?? current.confidence,
      pinned: input.pinned !== undefined ? (input.pinned ? 1 : 0) : current.pinned,
      inject_full: input.injectFull !== undefined ? (input.injectFull ? 1 : 0) : current.inject_full,
      updated_at: new Date().toISOString(),
    }
    getDb().prepare(`
      UPDATE agent_memory_entries SET
        title = @title,
        content = @content,
        tags = @tags,
        confidence = @confidence,
        pinned = @pinned,
        inject_full = @inject_full,
        updated_at = @updated_at
      WHERE id = @id
    `).run(next)
    return agentMemoryEntryStore.get(id)
  },

  touchUsed(ids: string[]): void {
    if (ids.length === 0) return
    const now = new Date().toISOString()
    const placeholders = ids.map(() => '?').join(',')
    const stmt = getDb().prepare(`
      UPDATE agent_memory_entries
      SET use_count = use_count + 1, last_used_at = ?
      WHERE id IN (${placeholders}) AND deleted_at IS NULL
    `)
    stmt.run(now, ...ids)
  },

  softDelete(id: string): void {
    getDb()
      .prepare('UPDATE agent_memory_entries SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), new Date().toISOString(), id)
  },

  searchByLike(dimensionIds: string[], keyword: string): Array<{ entry_id: string; score: number }> {
    if (dimensionIds.length === 0) return []
    const placeholders = dimensionIds.map(() => '?').join(',')
    return getDb()
      .prepare<Array<string>, { entry_id: string; score: number }>(`
        SELECT e.id AS entry_id, -0.5 AS score
        FROM agent_memory_entries e
        WHERE e.deleted_at IS NULL
          AND e.dimension_id IN (${placeholders})
          AND (e.title LIKE ? OR e.content LIKE ? OR e.tags LIKE ?)
      `)
      .all(...dimensionIds, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  },

  searchByFts(dimensionIds: string[], keyword: string): Array<{ entry_id: string; score: number }> {
    if (dimensionIds.length === 0) return []
    const placeholders = dimensionIds.map(() => '?').join(',')
    return getDb()
      .prepare<Array<string>, { entry_id: string; score: number }>(`
        SELECT f.entry_id AS entry_id, bm25(agent_memory_fts) AS score
        FROM agent_memory_fts f
        WHERE agent_memory_fts MATCH ?
          AND f.entry_id IN (
            SELECT e.id FROM agent_memory_entries e
            WHERE e.deleted_at IS NULL AND e.dimension_id IN (${placeholders})
          )
        ORDER BY score ASC
      `)
      .all(keyword, ...dimensionIds)
  },
}
