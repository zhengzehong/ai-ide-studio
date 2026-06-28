import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export interface SourceFingerprint {
  algorithm: 'sha256'
  files: Array<{ path: string; hash: string; size: number; mtimeMs: number }>
}

export interface KnowledgePageRow {
  id: string
  kb_id: string
  title: string
  title_norm: string
  section: string | null
  summary: string | null
  body: string
  author: string
  by: string | null
  tags_json: string
  is_index: number
  src_files_json: string
  src_fingerprint_json: string | null
  stale: number
  last_human_edit_at: string | null
  last_activity_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface CreateKnowledgePageInput {
  kbId: string
  title: string
  titleNorm: string
  section?: string | null
  summary?: string | null
  body: string
  author: string
  by?: string | null
  tags?: string[]
  isIndex?: boolean
  srcFiles?: string[]
  srcFingerprint?: SourceFingerprint | null
  stale?: boolean
  lastHumanEditAt?: string | null
}

export interface UpdateKnowledgePageInput {
  title?: string
  titleNorm?: string
  section?: string | null
  summary?: string | null
  body?: string
  author?: string
  by?: string | null
  tags?: string[]
  isIndex?: boolean
  srcFiles?: string[]
  srcFingerprint?: SourceFingerprint | null
  stale?: boolean
  lastHumanEditAt?: string | null
  lastActivityId?: string | null
  deletedAt?: string | null
}

export const knowledgePageStore = {
  create(input: CreateKnowledgePageInput): KnowledgePageRow {
    const now = new Date().toISOString()
    const row: KnowledgePageRow = {
      id: `kpg-${randomUUID().slice(0, 8)}`,
      kb_id: input.kbId,
      title: input.title,
      title_norm: input.titleNorm,
      section: input.section ?? null,
      summary: input.summary ?? null,
      body: input.body,
      author: input.author,
      by: input.by ?? null,
      tags_json: JSON.stringify(input.tags ?? []),
      is_index: input.isIndex ? 1 : 0,
      src_files_json: JSON.stringify(input.srcFiles ?? []),
      src_fingerprint_json: input.srcFingerprint ? JSON.stringify(input.srcFingerprint) : null,
      stale: input.stale ? 1 : 0,
      last_human_edit_at: input.lastHumanEditAt ?? null,
      last_activity_id: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }
    getDb().prepare(`
      INSERT INTO knowledge_pages (
        id, kb_id, title, title_norm, section, summary, body, author, by,
        tags_json, is_index, src_files_json, src_fingerprint_json, stale,
        last_human_edit_at, last_activity_id, created_at, updated_at, deleted_at
      )
      VALUES (
        @id, @kb_id, @title, @title_norm, @section, @summary, @body, @author, @by,
        @tags_json, @is_index, @src_files_json, @src_fingerprint_json, @stale,
        @last_human_edit_at, @last_activity_id, @created_at, @updated_at, @deleted_at
      )
    `).run(row)
    return row
  },

  get(id: string): KnowledgePageRow | undefined {
    return getDb()
      .prepare<[string], KnowledgePageRow>('SELECT * FROM knowledge_pages WHERE id = ? AND deleted_at IS NULL')
      .get(id)
  },

  getByTitle(kbId: string, titleNorm: string): KnowledgePageRow | undefined {
    return getDb()
      .prepare<[string, string], KnowledgePageRow>(`
        SELECT * FROM knowledge_pages
        WHERE kb_id = ? AND title_norm = ? AND deleted_at IS NULL
      `)
      .get(kbId, titleNorm)
  },

  listByKb(kbId: string): KnowledgePageRow[] {
    return getDb()
      .prepare<[string], KnowledgePageRow>(`
        SELECT * FROM knowledge_pages
        WHERE kb_id = ? AND deleted_at IS NULL
        ORDER BY is_index DESC, section ASC, title ASC
      `)
      .all(kbId)
  },

  listByKbs(kbIds: string[]): KnowledgePageRow[] {
    if (kbIds.length === 0) return []
    const placeholders = kbIds.map(() => '?').join(',')
    return getDb()
      .prepare<string[], KnowledgePageRow>(`
        SELECT * FROM knowledge_pages
        WHERE deleted_at IS NULL AND kb_id IN (${placeholders})
        ORDER BY updated_at DESC
      `)
      .all(...kbIds)
  },

  search(kbIds: string[], query: string, limit: number): KnowledgePageRow[] {
    if (kbIds.length === 0) return []
    const placeholders = kbIds.map(() => '?').join(',')
    return getDb()
      .prepare<Array<string | number>, KnowledgePageRow>(`
        SELECT * FROM knowledge_pages
        WHERE deleted_at IS NULL
          AND kb_id IN (${placeholders})
          AND (title LIKE ? OR COALESCE(summary, '') LIKE ? OR body LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `)
      .all(...kbIds, `%${query}%`, `%${query}%`, `%${query}%`, limit)
  },

  update(id: string, input: UpdateKnowledgePageInput): KnowledgePageRow | undefined {
    const current = knowledgePageStore.get(id)
    if (!current) return undefined
    const row: KnowledgePageRow = {
      ...current,
      title: input.title ?? current.title,
      title_norm: input.titleNorm ?? current.title_norm,
      section: input.section !== undefined ? input.section : current.section,
      summary: input.summary !== undefined ? input.summary : current.summary,
      body: input.body ?? current.body,
      author: input.author ?? current.author,
      by: input.by !== undefined ? input.by : current.by,
      tags_json: input.tags ? JSON.stringify(input.tags) : current.tags_json,
      is_index: input.isIndex !== undefined ? input.isIndex ? 1 : 0 : current.is_index,
      src_files_json: input.srcFiles ? JSON.stringify(input.srcFiles) : current.src_files_json,
      src_fingerprint_json: input.srcFingerprint !== undefined
        ? input.srcFingerprint ? JSON.stringify(input.srcFingerprint) : null
        : current.src_fingerprint_json,
      stale: input.stale !== undefined ? input.stale ? 1 : 0 : current.stale,
      last_human_edit_at: input.lastHumanEditAt !== undefined ? input.lastHumanEditAt : current.last_human_edit_at,
      last_activity_id: input.lastActivityId !== undefined ? input.lastActivityId : current.last_activity_id,
      updated_at: new Date().toISOString(),
      deleted_at: input.deletedAt !== undefined ? input.deletedAt : current.deleted_at,
    }
    getDb().prepare(`
      UPDATE knowledge_pages SET
        title = @title,
        title_norm = @title_norm,
        section = @section,
        summary = @summary,
        body = @body,
        author = @author,
        by = @by,
        tags_json = @tags_json,
        is_index = @is_index,
        src_files_json = @src_files_json,
        src_fingerprint_json = @src_fingerprint_json,
        stale = @stale,
        last_human_edit_at = @last_human_edit_at,
        last_activity_id = @last_activity_id,
        updated_at = @updated_at,
        deleted_at = @deleted_at
      WHERE id = @id
    `).run(row)
    return knowledgePageStore.get(id)
  },
}
