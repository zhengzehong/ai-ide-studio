import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { sessionStore } from '../../src/store/sessions.js'
import { taskStore } from '../../src/store/tasks.js'

interface QueryPlanRow {
  detail: string
}

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-query-plans-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
  seedRepresentativeRows()
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('hot Query Worker plans', () => {
  it('uses the project task index without a temporary sort', () => {
    const plan = explain(
      'SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC, rowid DESC',
      'project-plan',
    )

    expect(plan).toContain('USING INDEX idx_tasks_project_created')
    expect(plan).not.toContain('SCAN tasks')
    expect(plan).not.toContain('USE TEMP B-TREE FOR ORDER BY')
  })

  it('uses scoped indexes for Session rows and persisted runtime signals', () => {
    const plan = explain(
      `
      SELECT s.*,
        EXISTS (
          SELECT 1 FROM messages m
          WHERE m.session_id = s.id AND m.role = 'agent' AND m.status = 'running'
        ) AS has_running_agent_message,
        EXISTS (
          SELECT 1 FROM turn_process_items p
          WHERE p.session_id = s.id AND p.status IN ('running', 'pending', 'in_progress')
        ) AS has_running_process_item
      FROM sessions s
      WHERE s.deleted_at IS NULL AND s.is_template = 0 AND s.project_id = ?
      ORDER BY COALESCE(s.sort_order, 9223372036854775807) ASC, s.started_at ASC, s.id ASC
    `,
      'project-plan',
    )

    expect(plan).toContain('USING INDEX idx_sessions_project_agent_sort')
    expect(plan).toContain('USING COVERING INDEX idx_messages_session_role_status')
    expect(plan).toContain('USING COVERING INDEX idx_turn_process_items_session_status')
    expect(plan).not.toContain('SCAN s')
  })

  it('uses the Session timestamp index for message history pages', () => {
    const plan = explain(
      `
      SELECT * FROM messages
      WHERE session_id = ? AND timestamp < ?
      ORDER BY timestamp DESC
      LIMIT ?
    `,
      'session-plan',
      '9999-01-01T00:00:00.000Z',
      100,
    )

    expect(plan).toContain('USING INDEX idx_messages_session_timestamp')
    expect(plan).not.toContain('SCAN messages')
    expect(plan).not.toContain('USE TEMP B-TREE')
  })

  it('uses the Session sequence index for recovery event pages', () => {
    const plan = explain(
      `
      SELECT * FROM session_events
      WHERE session_id = ? AND sequence > ?
      ORDER BY sequence ASC
      LIMIT ?
    `,
      'session-plan',
      0,
      500,
    )

    expect(plan).toContain('USING INDEX idx_session_events_session_sequence')
    expect(plan).not.toContain('SCAN session_events')
    expect(plan).not.toContain('USE TEMP B-TREE')
  })
})

function explain(sql: string, ...parameters: Array<string | number>): string {
  return getDb()
    .prepare<Array<string | number>, QueryPlanRow>(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...parameters)
    .map((row) => row.detail)
    .join('\n')
}

function seedRepresentativeRows(): void {
  for (let index = 0; index < 40; index += 1) {
    taskStore.create({
      title: `Task ${index}`,
      description: 'query plan fixture',
      projectId: index < 30 ? 'project-plan' : 'project-other',
    })
    sessionStore.create({
      agentId: `agent-${index % 4}`,
      projectId: index < 30 ? 'project-plan' : 'project-other',
    })
  }
}
