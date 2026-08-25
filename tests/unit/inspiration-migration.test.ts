import Database from 'better-sqlite3'
import { describe, expect, test } from 'vitest'
import { projectInspirationMigration } from '../../src/store/migrations/052-project-inspiration.js'
import { inspirationAnalysisFinalizeMigration } from '../../src/store/migrations/053-inspiration-analysis-finalize.js'

describe('inspiration analysis finalize migration', () => {
  test('backfills only legacy date titles and adds attempt state', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)')
    projectInspirationMigration.up(db)
    db.prepare('INSERT INTO projects (id) VALUES (?)').run('project-1')
    const insert = db.prepare(`
      INSERT INTO inspiration_notes (
        id, project_id, title, source_markdown, attachments_json, status,
        analysis_revision, summary, body_markdown, questions_json,
        created_at, updated_at
      ) VALUES (?, 'project-1', ?, ?, '[]', 'ready', 1, '', '', '[]', ?, ?)
    `)
    const now = '2026-08-25T00:00:00.000Z'
    insert.run('auto-note', '8月25日 灵感', '4、AI发展到最后是什么，假设token不要钱的话，最后的形式', now, now)
    insert.run('manual-note', '人工标题', '正文不会覆盖人工标题', now, now)
    db.prepare(`
      UPDATE inspiration_notes
      SET summary = 'test', body_markdown = 'test', questions_json = '["question one","question two"]'
      WHERE id = 'auto-note'
    `).run()

    inspirationAnalysisFinalizeMigration.up(db)

    const rows = db.prepare<[], { id: string; title: string; title_mode: string; analysis_attempt_id: string | null; status: string; analysis_revision: number }>(
      'SELECT id, title, title_mode, analysis_attempt_id, status, analysis_revision FROM inspiration_notes ORDER BY id',
    ).all()
    expect(rows).toEqual([
      {
        id: 'auto-note',
        title: '4、AI发展到最后是什么，假设token不要钱的话，最后的形式',
        title_mode: 'auto',
        analysis_attempt_id: null,
        status: 'queued',
        analysis_revision: 2,
      },
      {
        id: 'manual-note',
        title: '人工标题',
        title_mode: 'manual',
        analysis_attempt_id: null,
        status: 'ready',
        analysis_revision: 1,
      },
    ])
    db.close()
  })
})
