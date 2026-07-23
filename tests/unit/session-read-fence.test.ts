import { describe, expect, test } from 'vitest'
import {
  createSessionReadFence,
  reconcileUnreadSessionIndicators,
} from '../../ui/src/stores/session-read-fence.ts'

describe('session read fence', () => {
  test('keeps a newer read acknowledgement over a stale server snapshot', () => {
    const fence = createSessionReadFence()
    const checkpoint = fence.checkpoint()
    fence.recordRead('session-a', '2026-07-23T00:03:00.000Z')

    const snapshot = fence.applySnapshot([{
      id: 'session-a',
      last_message_at: '2026-07-23T00:02:00.000Z',
      last_read_at: '2026-07-23T00:01:00.000Z',
    }], checkpoint)
    const unread = reconcileUnreadSessionIndicators({}, snapshot.sessions, null, {}, snapshot.forcedUnreadSessionIds)

    expect(snapshot.sessions[0]?.last_read_at).toBe('2026-07-23T00:03:00.000Z')
    expect(unread['session-a']).toBeUndefined()
  })

  test('replaces an old local unread entry with an authoritative read snapshot', () => {
    const fence = createSessionReadFence()
    const snapshot = fence.applySnapshot([{
      id: 'session-a',
      last_message_at: '2026-07-23T00:01:00.000Z',
      last_read_at: '2026-07-23T00:02:00.000Z',
    }], fence.checkpoint())

    expect(reconcileUnreadSessionIndicators(
      { 'session-a': true },
      snapshot.sessions,
      null,
      {},
      snapshot.forcedUnreadSessionIds,
    )).toEqual({})
  })

  test('preserves a background completion that arrives after the request checkpoint', () => {
    const fence = createSessionReadFence()
    const checkpoint = fence.checkpoint()
    fence.recordUnread('session-a')
    const snapshot = fence.applySnapshot([{
      id: 'session-a',
      last_message_at: '2026-07-23T00:01:00.000Z',
      last_read_at: '2026-07-23T00:01:00.000Z',
    }], checkpoint)

    expect(reconcileUnreadSessionIndicators(
      {},
      snapshot.sessions,
      null,
      {},
      snapshot.forcedUnreadSessionIds,
    )).toEqual({ 'session-a': true })
  })
})
