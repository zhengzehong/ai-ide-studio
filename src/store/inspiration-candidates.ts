import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'

export interface InspirationCandidateRow {
  id: string
  note_id: string
  analysis_revision: number
  sort_order: number
  title: string
  description_markdown: string
  suggested_agent_id: string | null
  agent_reason: string
  dispatch_token: string | null
  task_id: string | null
  execution_session_id: string | null
  created_at: string
  updated_at: string
}

export interface CreateCandidateInput {
  title: string
  descriptionMarkdown: string
  suggestedAgentId?: string | null
  agentReason?: string
}

export const inspirationCandidateStore = {
  create(
    noteId: string,
    revision: number,
    sortOrder: number,
    input: CreateCandidateInput,
    now = new Date().toISOString(),
  ): InspirationCandidateRow {
    const row: InspirationCandidateRow = {
      id: `candidate-${randomUUID().slice(0, 8)}`,
      note_id: noteId,
      analysis_revision: revision,
      sort_order: sortOrder,
      title: input.title,
      description_markdown: input.descriptionMarkdown,
      suggested_agent_id: input.suggestedAgentId ?? null,
      agent_reason: input.agentReason ?? '',
      dispatch_token: null,
      task_id: null,
      execution_session_id: null,
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO inspiration_candidates (
        id, note_id, analysis_revision, sort_order, title, description_markdown,
        suggested_agent_id, agent_reason, dispatch_token, task_id,
        execution_session_id, created_at, updated_at
      ) VALUES (
        @id, @note_id, @analysis_revision, @sort_order, @title, @description_markdown,
        @suggested_agent_id, @agent_reason, @dispatch_token, @task_id,
        @execution_session_id, @created_at, @updated_at
      )
    `).run(row)
    return row
  },

  get(id: string): InspirationCandidateRow | undefined {
    return getDb().prepare<[string], InspirationCandidateRow>(
      'SELECT * FROM inspiration_candidates WHERE id = ?',
    ).get(id)
  },

  listCurrent(noteId: string, revision: number): InspirationCandidateRow[] {
    return getDb().prepare<[string, number], InspirationCandidateRow>(`
      SELECT * FROM inspiration_candidates
      WHERE note_id = ? AND analysis_revision = ?
      ORDER BY sort_order ASC, id ASC
    `).all(noteId, revision)
  },

  update(id: string, input: { title: string; descriptionMarkdown: string; suggestedAgentId?: string | null }): InspirationCandidateRow | undefined {
    const result = getDb().prepare(`
      UPDATE inspiration_candidates
      SET title = ?, description_markdown = ?, suggested_agent_id = ?, updated_at = ?
      WHERE id = ? AND task_id IS NULL AND dispatch_token IS NULL
    `).run(input.title, input.descriptionMarkdown, input.suggestedAgentId ?? null, new Date().toISOString(), id)
    return result.changes === 1 ? this.get(id) : undefined
  },

  claimDispatch(id: string, token: string): InspirationCandidateRow | undefined {
    const result = getDb().prepare(`
      UPDATE inspiration_candidates
      SET dispatch_token = ?, updated_at = ?
      WHERE id = ? AND task_id IS NULL AND dispatch_token IS NULL
    `).run(token, new Date().toISOString(), id)
    return result.changes === 1 ? this.get(id) : undefined
  },

  completeDispatch(id: string, token: string, taskId: string, executionSessionId?: string): InspirationCandidateRow | undefined {
    getDb().prepare(`
      UPDATE inspiration_candidates
      SET task_id = ?, execution_session_id = ?, dispatch_token = NULL, updated_at = ?
      WHERE id = ? AND dispatch_token = ?
    `).run(taskId, executionSessionId ?? null, new Date().toISOString(), id, token)
    return this.get(id)
  },

  releaseDispatch(id: string, token: string): void {
    getDb().prepare(`
      UPDATE inspiration_candidates
      SET dispatch_token = NULL, updated_at = ?
      WHERE id = ? AND dispatch_token = ? AND task_id IS NULL
    `).run(new Date().toISOString(), id, token)
  },

  releaseStaleDispatches(): number {
    return getDb().prepare(`
      UPDATE inspiration_candidates
      SET dispatch_token = NULL, updated_at = ?
      WHERE dispatch_token IS NOT NULL AND task_id IS NULL
    `).run(new Date().toISOString()).changes
  },
}
