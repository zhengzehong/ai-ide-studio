import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { eventStore } from '../../src/store/sessions.js'
import { createDatabaseQueryPort } from '../../src/queries/database-query-port.js'
import { TEAM_MEMBER_STATE_TAIL_EVENTS } from '../../src/queries/team-member-state-query.js'

/**
 * P1 轻量恢复 + 迁移 075 的集成行为:
 * 挂起的 permission 可能埋在很深的历史里(生产实测一条在倒数第 729 条),
 * 尾巴扫描看不到,必须由 075 的部分索引单独兜住。
 */
let tmp: string
let dbPath: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-state-'))
  dbPath = resolve(tmp, 'ai-ide.sqlite')
  initDatabase(dbPath)
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('team member state query', () => {
  it('finds a pending permission buried deeper than the tail window', () => {
    const sessionId = 'session-deep'
    eventStore.append(sessionId, { type: 'permission.request', payload: { permissionRequest: { id: 'perm-deep', toolCall: {}, options: [] } } })
    // 在挂起请求之后塞入远超尾巴窗口的事件(生产中它们是 message.chunk 洪流)
    for (let index = 0; index < TEAM_MEMBER_STATE_TAIL_EVENTS + 50; index += 1) {
      eventStore.append(sessionId, { type: 'message.chunk', payload: { delta: 'x' } })
    }
    eventStore.append(sessionId, { type: 'usage.update', payload: { usage: { contextSize: 128000, contextUsed: 64000 } } })

    const snapshot = createDatabaseQueryPort().getTeamMemberState({ sessionId }) as unknown as Promise<{
      latestSequence: number
      usage: Record<string, unknown> | null
      pendingPermissions: { id: string }[]
      pendingElicitations: unknown[]
    }>

    return snapshot.then((state) => {
      expect(state.pendingPermissions.map((item) => item.id)).toEqual(['perm-deep'])
      expect(state.usage).toEqual({ contextSize: 128000, contextUsed: 64000 })
      expect(state.latestSequence).toBeGreaterThan(TEAM_MEMBER_STATE_TAIL_EVENTS)
    })
  })

  it('drops a permission once its result arrives, even when both sit far from the tail', () => {
    const sessionId = 'session-resolved'
    eventStore.append(sessionId, { type: 'permission.request', payload: { permissionRequest: { id: 'perm-old', toolCall: {}, options: [] } } })
    eventStore.append(sessionId, { type: 'permission.result', payload: { requestId: 'perm-old' } })
    for (let index = 0; index < TEAM_MEMBER_STATE_TAIL_EVENTS + 10; index += 1) {
      eventStore.append(sessionId, { type: 'message.chunk', payload: { delta: 'x' } })
    }

    return (createDatabaseQueryPort().getTeamMemberState({ sessionId }) as unknown as Promise<{ pendingPermissions: unknown[] }>)
      .then((state) => { expect(state.pendingPermissions).toEqual([]) })
  })

  it('returns an empty state for a session with no events', async () => {
    const state = await createDatabaseQueryPort().getTeamMemberState({ sessionId: 'session-empty' })

    expect(state).toEqual({
      sessionId: 'session-empty',
      latestSequence: 0,
      usage: null,
      pendingPermissions: [],
      pendingElicitations: [],
    })
  })

  it('uses the 075 partial index for the pending candidate lookup', () => {
    const plan = getDb().prepare(`
      EXPLAIN QUERY PLAN
      SELECT * FROM session_events
      WHERE session_id = ? AND type IN ('permission.request','permission.result','elicitation.request','elicitation.result')
      ORDER BY sequence DESC LIMIT 500
    `).all('session-x') as { detail: string }[]

    const detail = plan.map((row) => row.detail).join(' | ')
    expect(detail).toContain('idx_session_events_pending_lookup')
  })
})
