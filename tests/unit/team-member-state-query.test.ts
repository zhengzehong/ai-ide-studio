import { describe, expect, it } from 'vitest'
import { lastUsage, readTeamMemberState, reducePendingEvents } from '../../src/queries/team-member-state-query.js'
import type { SessionEventRow } from '../../src/store/sessions.js'

/**
 * P1 轻量恢复的归约语义:必须与前端 applySessionEvent
 * (ui/src/stores/session-events.ts:826-851)一致 —— 否则团队面板的
 * "等待权限"提示、用量数字会在切换后错乱。
 */
function event(type: string, payload: unknown, sequence: number): SessionEventRow {
  return {
    id: `evt-${sequence}`,
    session_id: 'session-a',
    agent_id: null,
    acp_session_id: null,
    message_id: null,
    type,
    role: null,
    payload_json: JSON.stringify(payload),
    sequence,
    created_at: '2026-09-17T00:00:00.000Z',
  }
}

describe('team member state reduction', () => {
  it('keeps only unresolved permission and elicitation requests', () => {
    const events = [
      event('permission.request', { permissionRequest: { id: 'perm-1', toolCall: {}, options: [] } }, 1),
      event('permission.request', { permissionRequest: { id: 'perm-2', toolCall: {}, options: [] } }, 2),
      event('permission.result', { requestId: 'perm-1' }, 3),
      event('elicitation.request', { elicitationRequest: { id: 'elicit-1', message: '确认吗' } }, 4),
      event('elicitation.result', { requestId: 'elicit-1' }, 5),
      event('elicitation.request', { elicitationRequest: { id: 'elicit-2', message: '再来一次' } }, 6),
    ]

    const pending = reducePendingEvents(events)

    expect(pending.pendingPermissions.map((item) => item.id)).toEqual(['perm-2'])
    expect(pending.pendingElicitations.map((item) => item.id)).toEqual(['elicit-2'])
  })

  it('takes the newest usage.update and ignores unrelated or malformed events', () => {
    const events = [
      event('usage.update', { usage: { contextSize: 10, contextUsed: 1 } }, 1),
      event('message.user', { content: 'hi' }, 2),
      event('usage.update', { usage: { contextSize: 20, contextUsed: 2 } }, 3),
      { ...event('usage.update', { usage: { contextSize: 30 } }, 4), payload_json: '{not json' },
    ]

    expect(lastUsage(events)).toEqual({ contextSize: 20, contextUsed: 2 })
    expect(lastUsage([event('message.user', { content: 'hi' }, 1)])).toBeNull()
  })

  it('composes latestSequence, tail usage and pending candidates into one snapshot', () => {
    const calls: string[] = []
    const result = readTeamMemberState({ sessionId: 'session-a' }, {
      latestSequence: () => 42,
      listRecent: (_sessionId, limit) => {
        calls.push(`tail:${limit}`)
        return [event('usage.update', { usage: { contextSize: 7 } }, 41)]
      },
      listPendingCandidates: (_sessionId, limit) => {
        calls.push(`pending:${limit}`)
        return [event('permission.request', { permissionRequest: { id: 'perm-9', toolCall: {}, options: [] } }, 12)]
      },
      now: () => 0,
    })

    expect(result.snapshot).toEqual({
      sessionId: 'session-a',
      latestSequence: 42,
      usage: { contextSize: 7 },
      pendingPermissions: [expect.objectContaining({ id: 'perm-9' })],
      pendingElicitations: [],
    })
    expect(result.diagnostics).toMatchObject({ operation: 'sessions.teamMemberState', tailEvents: 1, pendingEvents: 1 })
    expect(calls).toEqual(['tail:100', 'pending:500'])
  })

  it('does not see a usage.update that fell outside the tail window', () => {
    // 尾巴扫描的边界:usage.update 若早于最后 100 条(实测最远第 17 条,留了 5 倍余量),
    // 就不会被轻端点带回来 —— 用旧值兜底(前端显示上一次用量)是设计接受的取舍。
    const tail = Array.from({ length: 100 }, (_, index) => event('message.chunk', { delta: 'x' }, index + 1))

    expect(lastUsage(tail)).toBeNull()
  })
})
