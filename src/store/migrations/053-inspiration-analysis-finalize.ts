import { deriveInspirationTitle, isLegacyInspirationTitle } from '../../shared/inspiration-title.js'
import type { Migration } from '../migrator.js'

interface LegacyInspirationTitleRow {
  id: string
  title: string
  source_markdown: string
}

export const inspirationAnalysisFinalizeMigration: Migration = {
  version: '053',
  name: 'inspiration-analysis-finalize',
  up(db) {
    const columns = new Set(
      db.prepare<[], { name: string }>('PRAGMA table_info(inspiration_notes)').all().map((row) => row.name),
    )
    if (!columns.has('title_mode')) {
      db.exec("ALTER TABLE inspiration_notes ADD COLUMN title_mode TEXT NOT NULL DEFAULT 'manual'")
    }
    if (!columns.has('analysis_attempt_id')) {
      db.exec('ALTER TABLE inspiration_notes ADD COLUMN analysis_attempt_id TEXT')
    }

    const update = db.prepare(`
      UPDATE inspiration_notes
      SET title = ?, title_mode = 'auto'
      WHERE id = ?
    `)
    const rows = db.prepare<[], LegacyInspirationTitleRow>(`
      SELECT id, title, source_markdown FROM inspiration_notes
    `).all()
    for (const row of rows) {
      if (!isLegacyInspirationTitle(row.title)) continue
      const title = deriveInspirationTitle(row.source_markdown)
      if (title) update.run(title, row.id)
    }

    db.prepare(`
      UPDATE inspiration_notes
      SET status = 'queued', analysis_revision = analysis_revision + 1,
          summary = '', body_markdown = '', questions_json = '[]',
          last_error = NULL, organized_at = NULL, analysis_attempt_id = NULL,
          updated_at = ?
      WHERE lower(trim(summary)) = 'test'
        AND lower(trim(body_markdown)) = 'test'
        AND questions_json = '["question one","question two"]'
    `).run(new Date().toISOString())
  },
}
