import { getDb } from './db.js'
import { createChildLogger } from '../core/logger.js'
import type { SessionPurpose } from '../shared/session-visibility.js'

const log = createChildLogger('store:session-visibility')

// Aliases are internal SQL identifiers, never request input.
export function userVisibleSessionSql(alias: 's' | 'sessions' | 'step_session' = 's'): string {
  return `(${alias}.purpose = 'conversation'
    AND ${alias}.is_template = 0
    AND NOT EXISTS (SELECT 1 FROM project_advisors va WHERE va.session_id = ${alias}.id)
    AND NOT EXISTS (SELECT 1 FROM project_inspirations vi WHERE vi.session_id = ${alias}.id))`
}

export function effectiveSessionPurposeSql(): string {
  return `CASE
    WHEN s.purpose != 'conversation' THEN s.purpose
    WHEN EXISTS (SELECT 1 FROM project_advisors va WHERE va.session_id = s.id) THEN 'advisor_runtime'
    WHEN EXISTS (SELECT 1 FROM project_inspirations vi WHERE vi.session_id = s.id) THEN 'inspiration_runtime'
    ELSE s.purpose END`
}

// Preserve known legacy identity before a rebuild replaces its configuration link.
export function retainBackgroundSessionPurpose(
  sessionId: string | null | undefined,
  purpose: Extract<SessionPurpose, 'advisor_runtime' | 'inspiration_runtime'>,
): void {
  if (!sessionId) return
  const result = getDb().prepare("UPDATE sessions SET purpose = ? WHERE id = ? AND purpose = 'conversation'").run(purpose, sessionId)
  if (result.changes) log.info({ sessionId, purpose }, 'Legacy background session purpose retained')
}
