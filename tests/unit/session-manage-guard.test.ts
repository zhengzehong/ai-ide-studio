import { describe, expect, test } from 'vitest'
import {
  assertSessionManageable,
  sessionManageSkipReason,
  type SessionManageCandidate,
} from '../../src/core/session-manage-guard.js'
import { MAX_SESSION_TAG_LENGTH, MAX_SESSION_TAGS, normalizeSessionTags } from '../../src/core/sessions.js'

function candidate(overrides: Partial<SessionManageCandidate> = {}): SessionManageCandidate {
  return {
    id: 'sess-1',
    is_primary: 0,
    status: 'closed',
    activity_state: 'idle',
    purpose: 'conversation',
    archived_at: null,
    deleted_at: null,
    ...overrides,
  }
}

describe('session manage guard', () => {
  test('allows archiving a plain closed conversation session', () => {
    expect(sessionManageSkipReason(candidate(), 'archive')).toBeNull()
    expect(() => assertSessionManageable(candidate(), 'archive')).not.toThrow()
  })

  test('protects primary sessions from archiving', () => {
    expect(sessionManageSkipReason(candidate({ is_primary: 1 }), 'archive')).toBe('主会话不可归档')
  })

  test('protects running sessions from archiving', () => {
    expect(sessionManageSkipReason(candidate({ activity_state: 'running' }), 'archive')).toBe('运行中的会话不可归档')
    expect(
      sessionManageSkipReason(candidate({ activity_state: undefined, status: 'active' }), 'archive'),
    ).toBe('运行中的会话不可归档')
    expect(
      sessionManageSkipReason(candidate({ activity_state: undefined, status: 'closed' }), 'archive'),
    ).toBeNull()
  })

  test('protects system sessions from archiving and restoring', () => {
    expect(sessionManageSkipReason(candidate({ purpose: 'autonomy' }), 'archive')).toBe('系统会话不可归档')
    expect(
      sessionManageSkipReason(candidate({ purpose: 'secretary_chat', archived_at: '2026-09-01T00:00:00.000Z' }), 'restore'),
    ).toBe('系统会话不可还原')
  })

  test('rejects deleted sessions for both actions', () => {
    const deleted = candidate({ deleted_at: '2026-09-01T00:00:00.000Z' })
    expect(sessionManageSkipReason(deleted, 'archive')).toBe('会话已删除')
    expect(sessionManageSkipReason(deleted, 'restore')).toBe('会话已删除')
  })

  test('archive requires an unarchived session and restore requires an archived session', () => {
    expect(
      sessionManageSkipReason(candidate({ archived_at: '2026-09-01T00:00:00.000Z' }), 'archive'),
    ).toBe('会话已归档')
    expect(sessionManageSkipReason(candidate(), 'restore')).toBe('会话未归档')
    expect(
      sessionManageSkipReason(candidate({ archived_at: '2026-09-01T00:00:00.000Z' }), 'restore'),
    ).toBeNull()
    expect(() => assertSessionManageable(candidate(), 'restore')).toThrow('会话未归档')
  })
})

describe('normalizeSessionTags', () => {
  test('trims, drops empty tags and deduplicates while keeping order', () => {
    expect(normalizeSessionTags([' 调研 ', '', '  ', '调研', 'workbench'])).toEqual(['调研', 'workbench'])
  })

  test('rejects non-array input and non-string items', () => {
    expect(() => normalizeSessionTags('调研')).toThrow('tags 必须是字符串数组')
    expect(() => normalizeSessionTags(['ok', 42 as unknown as string])).toThrow('tags 必须是字符串数组')
  })

  test('rejects tags longer than the length limit', () => {
    const longTag = '字'.repeat(MAX_SESSION_TAG_LENGTH + 1)
    expect(() => normalizeSessionTags([longTag])).toThrow(`单个标签不能超过 ${MAX_SESSION_TAG_LENGTH} 个字符`)
    expect(normalizeSessionTags(['字'.repeat(MAX_SESSION_TAG_LENGTH)])).toHaveLength(1)
  })

  test('rejects more tags than the per-session limit', () => {
    const tags = Array.from({ length: MAX_SESSION_TAGS + 1 }, (_, index) => `标签${index + 1}`)
    expect(() => normalizeSessionTags(tags)).toThrow(`每个会话最多 ${MAX_SESSION_TAGS} 个标签`)
    expect(normalizeSessionTags(tags.slice(0, MAX_SESSION_TAGS))).toHaveLength(MAX_SESSION_TAGS)
  })
})
