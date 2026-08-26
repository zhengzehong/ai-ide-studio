import { randomUUID } from 'node:crypto'
import type { InspirationTitleMode } from '../shared/inspiration-title.js'
import { getDb } from './db.js'
import {
  parseCompleteInspirationDraft,
  readInspirationDraft,
  type InspirationAnalysisDraft,
} from './inspiration-analysis-draft.js'
import {
  inspirationCandidateStore,
  type CreateCandidateInput,
  type InspirationCandidateRow,
} from './inspiration-candidates.js'

export { inspirationCandidateStore } from './inspiration-candidates.js'
export type { CreateCandidateInput, InspirationCandidateRow } from './inspiration-candidates.js'

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
  analysis_attempt_kind: 'organize' | 'discussion' | null
  analysis_draft_json: string | null
  completed_at: string | null
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
      analysis_attempt_kind: null,
      analysis_draft_json: null,
      completed_at: null,
    }
    getDb().prepare(`
      INSERT INTO inspiration_notes (
        id, project_id, title, title_mode, source_markdown, attachments_json, status,
        analysis_revision, summary, body_markdown, questions_json, last_error,
        created_at, updated_at, organized_at, analysis_attempt_id,
        analysis_attempt_kind, analysis_draft_json, completed_at
      ) VALUES (
        @id, @project_id, @title, @title_mode, @source_markdown, @attachments_json, @status,
        @analysis_revision, @summary, @body_markdown, @questions_json, @last_error,
        @created_at, @updated_at, @organized_at, @analysis_attempt_id,
        @analysis_attempt_kind, @analysis_draft_json, @completed_at
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
          last_error = NULL, organized_at = NULL, analysis_attempt_id = NULL,
          analysis_attempt_kind = NULL, analysis_draft_json = NULL,
          completed_at = NULL, updated_at = ?
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
          organized_at = NULL, analysis_attempt_id = NULL,
          analysis_attempt_kind = NULL, analysis_draft_json = NULL,
          completed_at = NULL, updated_at = ?
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
        SET status = 'processing', analysis_attempt_id = ?, analysis_attempt_kind = 'organize',
            analysis_draft_json = ?, updated_at = ?
        WHERE id = ? AND status = 'queued'
      `).run(attemptId, JSON.stringify({ expectedRevision: row.analysis_revision }), new Date().toISOString(), row.id)
      return result.changes === 1 ? this.get(row.id) : undefined
    })()
  },

  setCompleted(id: string, completed: boolean): InspirationNoteRow | undefined {
    const current = this.get(id)
    if (!current) return undefined
    if (completed && (current.status === 'queued' || current.status === 'processing')) {
      throw new Error('灵感正在整理，完成后才能标记')
    }
    const now = new Date().toISOString()
    const result = getDb().prepare(`
      UPDATE inspiration_notes
      SET completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(completed ? now : null, now, id)
    return result.changes === 1 ? this.get(id) : undefined
  },

  beginDiscussion(id: string, expectedRevision: number): InspirationNoteRow | undefined {
    const attemptId = `attempt-${randomUUID().slice(0, 12)}`
    const result = getDb().prepare(`
      UPDATE inspiration_notes
      SET analysis_attempt_id = ?, analysis_attempt_kind = 'discussion',
          analysis_draft_json = ?, last_error = NULL, updated_at = ?
      WHERE id = ? AND analysis_revision = ? AND status IN ('ready', 'needs_input')
        AND analysis_attempt_id IS NULL
    `).run(
      attemptId,
      JSON.stringify({ expectedRevision }),
      new Date().toISOString(),
      id,
      expectedRevision,
    )
    return result.changes === 1 ? this.get(id) : undefined
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
      const requeued = db.prepare(`
        UPDATE inspiration_notes
        SET status = 'queued', summary = '', body_markdown = '', questions_json = '[]',
            analysis_attempt_id = NULL, analysis_attempt_kind = NULL, analysis_draft_json = NULL,
            last_error = NULL, organized_at = NULL, updated_at = ?
        WHERE status = 'processing'${projectFilter}
      `).run(...params).changes
      const discussionParams = projectId ? [new Date().toISOString(), projectId] : [new Date().toISOString()]
      db.prepare(`
        UPDATE inspiration_notes
        SET analysis_attempt_id = NULL, analysis_attempt_kind = NULL,
            analysis_draft_json = NULL, updated_at = ?
        WHERE status IN ('ready', 'needs_input') AND analysis_attempt_id IS NOT NULL${projectFilter}
      `).run(...discussionParams)
      return requeued
    })()
  },

  markFailed(id: string, revision: number, error: string, attemptId?: string): boolean {
    const db = getDb()
    return db.transaction(() => {
      const current = this.get(id)
      if (!current || current.analysis_revision !== revision) return false
      if (current.status !== 'queued' && current.status !== 'processing') return false
      if (attemptId && current.analysis_attempt_id !== attemptId) return false
      if (current.analysis_attempt_kind === 'discussion') {
        const updated = db.prepare(`
          UPDATE inspiration_notes
          SET analysis_attempt_id = NULL, analysis_attempt_kind = NULL,
              analysis_draft_json = NULL, updated_at = ?
          WHERE id = ? AND analysis_revision = ? AND analysis_attempt_id = ?
        `).run(new Date().toISOString(), id, revision, current.analysis_attempt_id)
        return updated.changes === 1
      }
      const updated = db.prepare(`
        UPDATE inspiration_notes
        SET status = 'failed', summary = '', body_markdown = '', questions_json = '[]',
            analysis_attempt_id = NULL, analysis_attempt_kind = NULL,
            analysis_draft_json = NULL, last_error = ?, updated_at = ?
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
    input: { summary: string; bodyMarkdown: string; questions: string[]; candidates: CreateCandidateInput[] },
  ): { staged: boolean; reason?: string; note?: InspirationNoteRow; candidates: InspirationCandidateRow[] } {
    const db = getDb()
    return db.transaction(() => {
      const current = this.get(id)
      if (!current) return { staged: false, reason: 'NOTE_NOT_FOUND', candidates: [] }
      if (current.analysis_revision !== expectedRevision) {
        return { staged: false, reason: 'ANALYSIS_REVISION_CONFLICT', note: current, candidates: [] }
      }
      const activeOrganize = current.status === 'processing' && current.analysis_attempt_kind === 'organize'
      const activeDiscussion = (current.status === 'ready' || current.status === 'needs_input')
        && current.analysis_attempt_kind === 'discussion'
      if (!current.analysis_attempt_id || (!activeOrganize && !activeDiscussion)) {
        return { staged: false, reason: 'ANALYSIS_ATTEMPT_CONFLICT', note: current, candidates: [] }
      }
      const draft = readInspirationDraft(current.analysis_draft_json, expectedRevision)
      if (!draft) return { staged: false, reason: 'ANALYSIS_ATTEMPT_CONFLICT', note: current, candidates: [] }
      const next: InspirationAnalysisDraft = {
        expectedRevision,
        summary: input.summary,
        bodyMarkdown: input.bodyMarkdown,
        questions: input.questions,
        candidates: input.candidates,
      }
      const updated = db.prepare(`
        UPDATE inspiration_notes SET analysis_draft_json = ?, updated_at = ?
        WHERE id = ? AND analysis_revision = ? AND analysis_attempt_id = ?
      `).run(JSON.stringify(next), new Date().toISOString(), id, expectedRevision, current.analysis_attempt_id)
      return updated.changes === 1
        ? { staged: true, note: this.get(id), candidates: [] }
        : { staged: false, reason: 'ANALYSIS_ATTEMPT_CONFLICT', note: this.get(id), candidates: [] }
    })()
  },

  finalizeAnalysis(id: string, expectedRevision: number, expectedAttemptId: string): boolean {
    const db = getDb()
    return db.transaction(() => {
      const current = this.get(id)
      if (!current || current.analysis_revision !== expectedRevision || current.analysis_attempt_id !== expectedAttemptId) return false
      const activeOrganize = current.status === 'processing' && current.analysis_attempt_kind === 'organize'
      const activeDiscussion = (current.status === 'ready' || current.status === 'needs_input')
        && current.analysis_attempt_kind === 'discussion'
      if (!activeOrganize && !activeDiscussion) return false
      const draft = parseCompleteInspirationDraft(current.analysis_draft_json, expectedRevision)
      if (!draft) return false
      const targetRevision = current.analysis_attempt_kind === 'discussion'
        ? expectedRevision + 1
        : expectedRevision
      const now = new Date().toISOString()
      const updated = db.prepare(`
        UPDATE inspiration_notes
        SET status = 'ready', analysis_revision = ?, summary = ?, body_markdown = ?,
            questions_json = ?, analysis_attempt_id = NULL, analysis_attempt_kind = NULL,
            analysis_draft_json = NULL, completed_at = NULL,
            last_error = NULL, organized_at = ?, updated_at = ?
        WHERE id = ? AND analysis_attempt_id = ?
      `).run(
        targetRevision,
        draft.summary,
        draft.bodyMarkdown,
        JSON.stringify(draft.questions),
        now,
        now,
        id,
        expectedAttemptId,
      )
      if (updated.changes !== 1) return false
      db.prepare('DELETE FROM inspiration_candidates WHERE note_id = ? AND analysis_revision = ? AND task_id IS NULL')
        .run(id, targetRevision)
      draft.candidates.forEach((candidate, index) => {
        inspirationCandidateStore.create(id, targetRevision, index, candidate, now)
      })
      return true
    })()
  },

  discardDiscussion(id: string, attemptId: string): boolean {
    return getDb().prepare(`
      UPDATE inspiration_notes
      SET analysis_attempt_id = NULL, analysis_attempt_kind = NULL,
          analysis_draft_json = NULL, updated_at = ?
      WHERE id = ? AND analysis_attempt_id = ? AND analysis_attempt_kind = 'discussion'
    `).run(new Date().toISOString(), id, attemptId).changes === 1
  },
}
