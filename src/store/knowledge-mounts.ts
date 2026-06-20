import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export interface KnowledgeMountRow {
  id: string
  project_id: string
  kb_id: string
  created_by: string | null
  created_at: string
  deleted_at: string | null
}

export const knowledgeMountStore = {
  create(input: { projectId: string; kbId: string; createdBy?: string | null }): KnowledgeMountRow {
    const now = new Date().toISOString()
    const existing = knowledgeMountStore.get(input.projectId, input.kbId)
    if (existing) return existing
    const row: KnowledgeMountRow = {
      id: `kbm-${randomUUID().slice(0, 8)}`,
      project_id: input.projectId,
      kb_id: input.kbId,
      created_by: input.createdBy ?? null,
      created_at: now,
      deleted_at: null,
    }
    getDb().prepare(`
      INSERT INTO knowledge_mounts (id, project_id, kb_id, created_by, created_at, deleted_at)
      VALUES (@id, @project_id, @kb_id, @created_by, @created_at, @deleted_at)
    `).run(row)
    return row
  },

  get(projectId: string, kbId: string): KnowledgeMountRow | undefined {
    return getDb()
      .prepare<[string, string], KnowledgeMountRow>(`
        SELECT * FROM knowledge_mounts
        WHERE project_id = ? AND kb_id = ? AND deleted_at IS NULL
      `)
      .get(projectId, kbId)
  },

  listByProject(projectId: string): KnowledgeMountRow[] {
    return getDb()
      .prepare<[string], KnowledgeMountRow>(`
        SELECT * FROM knowledge_mounts
        WHERE project_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC
      `)
      .all(projectId)
  },

  remove(projectId: string, kbId: string): KnowledgeMountRow | undefined {
    const existing = knowledgeMountStore.get(projectId, kbId)
    if (!existing) return undefined
    getDb()
      .prepare('UPDATE knowledge_mounts SET deleted_at = ? WHERE id = ?')
      .run(new Date().toISOString(), existing.id)
    return { ...existing, deleted_at: new Date().toISOString() }
  },
}
