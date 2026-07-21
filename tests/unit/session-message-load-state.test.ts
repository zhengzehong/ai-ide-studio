import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultCaps } from '../../ui/src/stores/session-events.ts'

const wsMock = vi.hoisted(() => ({
  request: vi.fn(async () => [] as unknown[]),
  on: vi.fn(() => () => undefined),
  send: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('../../ui/src/services/ws-client', () => ({ wsClient: wsMock }))

const { useSessionStore } = await import('../../ui/src/stores/session.store.ts')

describe('session message load state', () => {
  beforeEach(() => {
    wsMock.request.mockReset()
    useSessionStore.setState({
      currentSessionId: 'session-a',
      messages: [],
      events: [],
      streamingMessage: null,
      usage: null,
      turnUsage: null,
      capabilities: { ...defaultCaps },
      plan: [],
      pendingPermissions: [],
      pendingElicitations: [],
      messagesLoadingSessionId: null,
      messagesErrorBySession: {},
    })
  })

  test('shows a message failure and clears it after retry', async () => {
    wsMock.request.mockRejectedValueOnce(new Error('Message history unavailable'))

    await useSessionStore.getState().fetchMessages('session-a')

    expect(useSessionStore.getState().messagesLoadingSessionId).toBeNull()
    expect(useSessionStore.getState().messagesErrorBySession['session-a'])
      .toBe('Message history unavailable')

    wsMock.request.mockResolvedValueOnce([])
    await useSessionStore.getState().fetchMessages('session-a')

    expect(useSessionStore.getState().messagesErrorBySession['session-a']).toBeUndefined()
  })
})
