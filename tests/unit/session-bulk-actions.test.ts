import { describe, expect, test } from 'vitest'
import {
  buildSessionBulkActionResult,
  canBatchDeleteSession,
  normalizeSessionIds,
  type SessionBulkCandidate,
} from '../../src/core/session-bulk-actions.js'

describe('session bulk actions', () => {
  test('deduplicates and bounds session ids without changing order', () => {
    expect(normalizeSessionIds(['a', 'b', 'a', ' ', 'c'])).toEqual(['a', 'b', 'c'])
  })

  test('protects primary, running, and system sessions from batch deletion', () => {
    const base: SessionBulkCandidate = {
      id: 'session-1',
      agent_id: 'agent-1',
      project_id: 'project-1',
      is_primary: 0,
      status: 'closed',
      purpose: 'conversation',
      deleted_at: null,
    }
    expect(canBatchDeleteSession(base)).toBe(true)
    expect(canBatchDeleteSession({ ...base, is_primary: 1 })).toBe(false)
    expect(canBatchDeleteSession({ ...base, status: 'active' })).toBe(false)
    expect(canBatchDeleteSession({ ...base, purpose: 'secretary_chat' })).toBe(false)
  })

  test('returns succeeded and skipped ids with reasons', () => {
    const result = buildSessionBulkActionResult(
      'delete',
      ['a', 'b'],
      [{ sessionId: 'c', reason: '主会话不可批量删除' }],
    )
    expect(result).toEqual({ action: 'delete', succeeded: ['a', 'b'], skipped: [{ sessionId: 'c', reason: '主会话不可批量删除' }] })
  })
})
