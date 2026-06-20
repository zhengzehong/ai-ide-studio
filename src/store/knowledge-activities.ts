import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export type KnowledgeActivityAct = 'create' | 'edit' | 'refresh' | 'revert' | 'mount' | 'unmount' | 'create_kb'
export type KnowledgeActorType = 'human' | 'ai' | 'system'

export interface KnowledgeActivityRow {
  id: string
  kb_id: string
  page_id: string | null
  act: KnowledgeActivityAct
  actor: string
  actor_type: KnowledgeActorType
  tool: string
  note: string | null
  prev_body: string | null
  prev_snapshot_json: string | null
  next_snapshot_json: string | null
  reverted_at: string | null
  reverted_by: string | null
  revert_activity_id: string | null
  created_at: string
}

export interface CreateKnowledgeActivityInput {
  kbId: string
  pageId?: string | null
  act: KnowledgeActivityAct
  actor: string
  actorType: KnowledgeActorType
  tool: string
  note?: string | null
  prevBody?: string | null
  prevSnapshot?: Record<string, unknown> | null
  nextSnapshot?: Record<string, unknown> | null
}

export const knowledgeActivityStore = {
  create(input: CreateKnowledgeActivityInput): KnowledgeActivityRow {
    const row: KnowledgeActivityRow = {
      id: `kact-${randomUUID().slice(0, 8)}`,
      kb_id: input.kbId,
      page_id: input.pageId ?? null,
      act: input.act,
      actor: input.actor,
      actor_type: input.actorType,
      tool: input.tool,
      note: input.note ?? null,
      prev_body: input.prevBody ?? null,
      prev_snapshot_json: input.prevSnapshot ? JSON.stringify(input.prevSnapshot) : null,
      next_snapshot_json: input.nextSnapshot ? JSON.stringify(input.nextSnapshot) : null,
      reverted_at: null,
      reverted_by: null,
      revert_activity_id: null,
      created_at: new Date().toISOString(),
    }
    getDb().prepare(`
      INSERT INTO knowledge_activities (
        id, kb_id, page_id, act, actor, actor_type, tool, note, prev_body,
        prev_snapshot_json, next_snapshot_json, reverted_at, reverted_by,
        revert_activity_id, created_at
      )
      VALUES (
        @id, @kb_id, @page_id, @act, @actor, @actor_type, @tool, @note, @prev_body,
        @prev_snapshot_json, @next_snapshot_json, @reverted_at, @reverted_by,
        @revert_activity_id, @created_at
      )
    `).run(row)
    return row
  },

  get(id: string): KnowledgeActivityRow | undefined {
    return getDb().prepare<[string], KnowledgeActivityRow>('SELECT * FROM knowledge_activities WHERE id = ?').get(id)
  },

  list(kbId?: string): KnowledgeActivityRow[] {
    if (kbId) {
      return getDb()
        .prepare<[string], KnowledgeActivityRow>(`
          SELECT * FROM knowledge_activities
          WHERE kb_id = ?
          ORDER BY created_at DESC, id DESC
        `)
        .all(kbId)
    }
    return getDb()
      .prepare<[], KnowledgeActivityRow>('SELECT * FROM knowledge_activities ORDER BY created_at DESC, id DESC')
      .all()
  },

  markReverted(id: string, actor: string, revertActivityId: string): KnowledgeActivityRow | undefined {
    getDb().prepare(`
      UPDATE knowledge_activities
      SET reverted_at = ?, reverted_by = ?, revert_activity_id = ?
      WHERE id = ?
    `).run(new Date().toISOString(), actor, revertActivityId, id)
    return knowledgeActivityStore.get(id)
  },
}
