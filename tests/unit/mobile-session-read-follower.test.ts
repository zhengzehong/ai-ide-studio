import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import {
  shouldAcknowledgeDoneRead,
  useSessionStore,
} from '../../mobile/src/stores/session.store'
import { useMobileActivityStore } from '../../mobile/src/stores/activity.store'
import { wsClient } from '@desktop/services/ws-client'

vi.mock('@desktop/services/ws-client', () => ({
  wsClient: {
    request: vi.fn(),
    on: vi.fn(() => () => {}),
  },
}))

describe('mobile session read follower', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  test('shouldAcknowledgeDoneRead mirrors the PC session:done rule', () => {
    // 正在看的会话 → 跟随标已读
    expect(shouldAcknowledgeDoneRead('s1', 's1', {})).toBe(true)
    // 不是当前会话 → 不动,保留未读提醒
    expect(shouldAcknowledgeDoneRead('s1', 's2', {})).toBe(false)
    expect(shouldAcknowledgeDoneRead('s1', null, {})).toBe(false)
    // 手动标过未读的会话 → 不自动清(对齐 PC explicitUnread)
    expect(shouldAcknowledgeDoneRead('s1', 's1', { s1: true })).toBe(false)
  })

  test('markUnread records the explicit flag and markRead clears it', async () => {
    vi.mocked(wsClient.request).mockResolvedValue({ lastReadAt: '2026-08-28T10:00:00.000Z' })
    const store = useSessionStore.getState()
    useSessionStore.setState({
      sessions: [{
        id: 's1', agentId: 'a1', agentName: 'A', projectId: null, projectName: null,
        taskId: null, sessionTitle: null, status: 'active', activityState: 'idle', stage: '',
        unread: false, startedAt: '2026-08-28T09:00:00.000Z', updatedAt: null, lastMessageAt: '2026-08-28T09:30:00.000Z',
        lastReadAt: '2026-08-28T09:30:00.000Z', closedAt: null, purpose: 'conversation',
      }],
      explicitUnreadIds: {},
    })

    await store.markUnread('s1')
    expect(useSessionStore.getState().explicitUnreadIds).toEqual({ s1: true })

    await useSessionStore.getState().markRead('s1')
    expect(useSessionStore.getState().explicitUnreadIds).toEqual({})
  })

  test('clearUnreadLocally drops the session from activity groups without an RPC', () => {
    useMobileActivityStore.setState({
      groups: [{
        groupId: 'g1', agentId: 'a1', agentName: 'A', agentIcon: null,
        projectId: null, projectName: null, activityAt: '2026-08-28T10:00:00.000Z',
        sessions: [{
          sessionId: 's1', taskId: null, taskTitle: null, taskStatus: null, sessionTitle: null,
          status: 'active', stage: '', running: false, unread: true,
          attentionState: 'unread', activityAt: '2026-08-28T10:00:00.000Z',
        }],
      }],
    })

    useMobileActivityStore.getState().clearUnreadLocally('s1')

    expect(useMobileActivityStore.getState().groups).toEqual([])
    expect(vi.mocked(wsClient.request)).not.toHaveBeenCalled()
  })

  test('wires the done follower into the session:done handler', () => {
    const source = readFileSync(resolve('mobile/src/stores/session.store.ts'), 'utf8')
    expect(source).toContain("wsClient.on('session:done'")
    expect(source).toContain('shouldAcknowledgeDoneRead(sessionId, get().currentSessionId, get().explicitUnreadIds)')
    expect(source).toContain('clearUnreadLocally(sessionId)')
  })
})
