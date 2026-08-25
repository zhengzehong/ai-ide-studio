import { randomUUID } from 'node:crypto'
import type { InspirationTitleMode } from '../shared/inspiration-title.js'
import { getDb } from './db.js'

export type InspirationNoteStatus = 'draft' | 'queued' | 'processing' | 'ready' | 'needs_input' | 'failed'
export type { InspirationTitleMode } from '../shared/inspiration-title.js'

export interface InspirationNoteRow {
  id: string
  project_id: string
  title: string
  title_mode: InspirationTitleMode
  source_markdown: string
  attachments_json: string
  status: InspirationNoteStatus
  analysis_revision: number
  summary: string
  body_markdown: string
  questions_json: string
  last_error: string | null
  created_at: string
  updated_at: string
  organized_at: string | null
  analysis_attempt_id: string | null
}

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

export const inspirationNoteStore = {
  create(input: {
    id?: string
    projectId: string
    title: string
    titleMode?: InspirationTitleMode
    sourceMarkdown: string
    attachments?: unknown[]
    queued?: boolean
  }): InspirationNoteRow {
    const now = new Date().toISOString()
    const row: InspirationNoteRow = {
      id: input.id ?? `inspiration-${randomUUID().slice(0, 8)}`,
      project_id: input.projectId,
      title: input.title,
      title_mode: input.titleMode ?? 'manual',
      source_markdown: input.sourceMarkdown,
      attachments_json: JSON.stringify(input.attachments ?? []),
      status: input.queued ? 'queued' : 'draft',
      analysis_revision: input.queued ? 1 : 0,
      summary: '',
      body_markdown: '',
      questions_json: '[]',
      last_error: null,
      created_at: now,
      updated_at: now,
      organized_at: null,
      analysis_attempt_id: null,
    }
    getDb().prepare(`
      INSERT INTO inspiration_notes (
        id, project_id, title, title_mode, source_markdown, attachments_json, status,
        analysis_revision, summary, body_markdown, questions_json, last_error,
        created_at, updated_at, organized_at, analysis_attempt_id
      ) VALUES (
        @id, @project_id, @title, @title_mode, @source_markdown, @attachments_json, @status,
        @analysis_revision, @summary, @body_markdown, @questions_json, @last_error,
        @created_at, @updated_at, @organized_at, @analysis_attempt_id
      )
    `).run(row)
    return row
  },

  get(id: string): InspirationNoteRow | undefined {
    return getDb().prepare<[string], InspirationNoteRow>('SELECT * FROM inspiration_notes WHERE id = ?').get(id)
  },

  list(projectId: string, limit = 200): InspirationNoteRow[] {
    return getDb().prepare<{ projectId: string; limit: number }, InspirationNoteRow>(`
      SELECT * FROM inspiration_notes
      WHERE project_id = @projectId
      ORDER BY updated_at DESC, id DESC
      LIMIT @limit
    `).all({ projectId, limit })
  },

  delete(id: string): boolean {
    return getDb().prepare('DELETE FROM inspiration_notes WHERE id = ?').run(id).changes === 1
  },

  updateSource(
    id: string,
    input: { title: string; titleMode?: InspirationTitleMode; sourceMarkdown: string; attachments?: unknown[]; queue: boolean },
  ): InspirationNoteRow | undefined {
    const current = this.get(id)
    if (!current) return undefined
    const nextRevision = input.queue ? current.analysis_revision + 1 : current.analysis_revision
    const status: InspirationNoteStatus = input.queue ? 'queued' : 'draft'
    getDb().prepare(`
      UPDATE inspiration_notes
      SET title = ?, title_mode = ?, source_markdown = ?, attachments_json = ?, status = ?,
          analysis_revision = ?, summary = '', body_markdown = '', questions_json = '[]',
          last_error = NULL, organized_at = NULL, analysis_attempt_id = NULL, updated_at = ?
      WHERE id = ?
    `).run(
      input.title,
      input.titleMode ?? current.title_mode,
      input.sourceMarkdown,
      JSON.stringify(input.attachments ?? []),
      status,
      nextRevision,
      new Date().toISOString(),
      id,
    )
    return this.get(id)
  },

  queue(id: string): InspirationNoteRow | undefined {
    const current = this.get(id)
    if (!current) return undefined
    getDb().prepare(`
      UPDATE inspiration_notes
      SET status = 'queued', analysis_revision = analysis_revision + 1,
          summary = '', body_markdown = '', questions_json = '[]', last_error = NULL,
          organized_at = NULL, analysis_attempt_id = NULL, updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), id)
    return this.get(id)
  },

  claimNext(projectId: string): InspirationNoteRow | undefined {
    const db = getDb()
    return db.transaction(() => {
      const row = db.prepare<[string], InspirationNoteRow>(`
        SELECT * FROM inspiration_notes
        WHERE project_id = ? AND status = 'queued'
        ORDER BY updated_at ASC, id ASC
        LIMIT 1
      `).get(projectId)
      if (!row) return undefined
      const attemptId = `attempt-${randomUUID().slice(0, 12)}`
      const result = db.prepare(`
        UPDATE inspiration_notes
        SET status = 'processing', analysis_attempt_id = ?, updated_at = ?
        WHERE id = ? AND status = 'queued'
      `).run(attemptId, new Date().toISOString(), row.id)
      return result.changes === 1 ? this.get(row.id) : undefined
    })()
  },

  requeueProcessing(projectId?: string): number {
    const db = getDb()
    return db.transaction(() => {
      const projectFilter = projectId ? ' AND project_id = ?' : ''
      const rows = db.prepare<unknown[], { id: string; analysis_revision: number }>(`
        SELECT id, analysis_revision FROM inspiration_notes
        WHERE status = 'processing'${projectFilter}
      `).all(...(projectId ? [projectId] : []))
      const removeCandidates = db.prepare(`
        DELETE FROM inspiration_candidates
        WHERE note_id = ? AND analysis_revision = ? AND task_id IS NULL
      `)
      for (const row of rows) removeCandidates.run(row.id, row.analysis_revision)
      const params = projectId ? [new Date().toISOString(), projectId] : [new Date().toISOString()]
      return db.prepare(`
        UPDATE inspiration_notes
        SET status = 'queued', summary = '', body_markdown = '', questions_json = '[]',
            analysis_attempt_id = NULL, last_error = NULL, organized_at = NULL, updated_at = ?
        WHERE status = 'processing'${projectFilter}
      `).run(...params).changes
    })()
  },

  markFailed(id: string, revision: number, error: string, attemptId?: string): boolean {
    const db = getDb()
    return db.transaction(() => {
      const current = this.get(id)
      if (!current || current.analysis_revision !== revision) return false
      if (current.status !== 'queued' && current.status !== 'processing') return false
      if (attemptId && current.analysis_attempt_id !== attemptId) return false
      const updated = db.prepare(`
        UPDATE inspiration_notes
        SET status = 'failed', summary = '', body_markdown = '', questions_json = '[]',
            analysis_attempt_id = NULL, last_error = ?, updated_at = ?
        WHERE id = ? AND analysis_revision = ? AND status IN ('queued', 'processing')
      `).run(error, new Date().toISOString(), id, revision)
      if (updated.changes !== 1) return false
      db.prepare(`
        DELETE FROM inspiration_candidates
        WHERE note_id = ? AND analysis_revision = ? AND task_id IS NULL
      `).run(id, revision)
      return true
    })()
  },

  stageAnalysis(
    id: string,
    expectedRevision: number,
    expectedAttemptId: string,
    input: { summary: string; bodyMarkdown: string; questions: string[]; candidates: CreateCandidateInput[] },
  ): { staged: boolean; reason?: string; note?: InspirationNoteRow; candidates: InspirationCandidateRow[] } {
    const db = getDb()
    return db.transaction(() => {
      const current = this.get(id)
      if (!current) return { staged: false, reason: 'NOTE_NOT_FOUND', candidates: [] }
      if (current.analysis_revision !== expectedRevision) {
        return { staged: false, reason: 'ANALYSIS_REVISION_CONFLICT', note: current, candidates: [] }
      }
      if (current.status !== 'processing' || current.analysis_attempt_id !== expectedAttemptId) {
        return { staged: false, reason: 'ANALYSIS_ATTEMPT_CONFLICT', note: current, candidates: [] }
      }
      const now = new Date().toISOString()
      const updated = db.prepare(`
        UPDATE inspiration_notes
        SET summary = ?, body_markdown = ?, questions_json = ?, last_error = NULL, updated_at = ?
        WHERE id = ? AND analysis_revision = ? AND status = 'processing' AND analysis_attempt_id = ?
      `).run(input.summary, input.bodyMarkdown, JSON.stringify(input.questions), now, id, expectedRevision, expectedAttemptId)
      if (updated.changes !== 1) {
        return { staged: false, reason: 'ANALYSIS_ATTEMPT_CONFLICT', note: this.get(id), candidates: [] }
      }
      db.prepare('DELETE FROM inspiration_candidates WHERE note_id = ? AND analysis_revision = ? AND task_id IS NULL')
        .run(id, expectedRevision)
      input.candidates.forEach((candidate, index) => {
        inspirationCandidateStore.create(id, expectedRevision, index, candidate, now)
      })
      return {
        staged: true,
        note: this.get(id),
        candidates: inspirationCandidateStore.listCurrent(id, expectedRevision),
      }
    })()
  },

  finalizeAnalysis(id: string, expectedRevision: number, expectedAttemptId: string): boolean {
    const current = this.get(id)
    if (!current || current.analysis_revision !== expectedRevision) return false
    if (current.status !== 'processing' || current.analysis_attempt_id !== expectedAttemptId) return false
    if (current.summary.trim().length < 8 || current.body_markdown.trim().length < 80) return false
    const now = new Date().toISOString()
    return getDb().prepare(`
      UPDATE inspiration_notes
      SET status = 'ready', analysis_attempt_id = NULL, organized_at = ?, updated_at = ?
      WHERE id = ? AND analysis_revision = ? AND status = 'processing' AND analysis_attempt_id = ?
    `).run(now, now, id, expectedRevision, expectedAttemptId).changes === 1
  },
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
