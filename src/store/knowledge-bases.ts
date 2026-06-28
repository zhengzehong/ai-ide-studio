import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export type KnowledgeBaseKind = 'project' | 'shared'
export type KnowledgeBaseSource = 'manual' | 'code'

export interface KnowledgeBaseRow {
  id: string
  name: string
  kind: KnowledgeBaseKind
  src: KnowledgeBaseSource
  icon: string | null
  description: string | null
  project_id: string | null
  index_page_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface CreateKnowledgeBaseInput {
  name: string
  kind: KnowledgeBaseKind
  src: KnowledgeBaseSource
  icon?: string | null
  description?: string | null
  projectId?: string | null
}

export const knowledgeBaseStore = {
  create(input: CreateKnowledgeBaseInput): KnowledgeBaseRow {
    const now = new Date().toISOString()
    const row: KnowledgeBaseRow = {
      id: `kb-${randomUUID().slice(0, 8)}`,
      name: input.name,
      kind: input.kind,
      src: input.src,
      icon: input.icon ?? null,
      description: input.description ?? null,
      project_id: input.kind === 'project' ? input.projectId ?? null : null,
      index_page_id: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }
    getDb().prepare(`
      INSERT INTO knowledge_bases (
        id, name, kind, src, icon, description, project_id, index_page_id,
        created_at, updated_at, deleted_at
      )
      VALUES (
        @id, @name, @kind, @src, @icon, @description, @project_id, @index_page_id,
        @created_at, @updated_at, @deleted_at
      )
    `).run(row)
    return row
  },

  get(id: string): KnowledgeBaseRow | undefined {
    return getDb()
      .prepare<[string], KnowledgeBaseRow>('SELECT * FROM knowledge_bases WHERE id = ? AND deleted_at IS NULL')
      .get(id)
  },

  getProject(projectId: string): KnowledgeBaseRow | undefined {
    return getDb()
      .prepare<[string], KnowledgeBaseRow>(`
        SELECT * FROM knowledge_bases
        WHERE kind = 'project' AND project_id = ? AND deleted_at IS NULL
      `)
      .get(projectId)
  },

  listShared(): KnowledgeBaseRow[] {
    return getDb()
      .prepare<[], KnowledgeBaseRow>(`
        SELECT * FROM knowledge_bases
        WHERE kind = 'shared' AND deleted_at IS NULL
        ORDER BY updated_at DESC
      `)
      .all()
  },

  listVisible(projectId: string): KnowledgeBaseRow[] {
    return getDb()
      .prepare<[string, string], KnowledgeBaseRow>(`
        SELECT * FROM knowledge_bases
        WHERE deleted_at IS NULL
          AND (
            (kind = 'project' AND project_id = ?)
            OR id IN (
              SELECT kb_id FROM knowledge_mounts
              WHERE project_id = ? AND deleted_at IS NULL
            )
          )
        ORDER BY kind ASC, updated_at DESC
      `)
      .all(projectId, projectId)
  },

  setIndexPage(kbId: string, pageId: string): KnowledgeBaseRow | undefined {
    getDb()
      .prepare('UPDATE knowledge_bases SET index_page_id = ?, updated_at = ? WHERE id = ?')
      .run(pageId, new Date().toISOString(), kbId)
    return knowledgeBaseStore.get(kbId)
  },

  touch(kbId: string): void {
    getDb().prepare('UPDATE knowledge_bases SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), kbId)
  },
}
