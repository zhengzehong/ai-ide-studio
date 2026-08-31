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

  test('reuses an in-flight message request for the same session', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined
    wsMock.request.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRequest = resolve
    }))

    const first = useSessionStore.getState().fetchMessages('session-a')
    const second = useSessionStore.getState().fetchMessages('session-a')

    expect(wsMock.request).toHaveBeenCalledTimes(1)
    expect(useSessionStore.getState().messagesLoadingSessionId).toBe('session-a')

    resolveRequest?.([])
    await Promise.all([first, second])

    expect(useSessionStore.getState().messagesLoadingSessionId).toBeNull()
  })

  test('runs a trailing recovery refresh when it arrives during an in-flight request', async () => {
    const resolvers: Array<(value: unknown[]) => void> = []
    wsMock.request.mockImplementation(() => new Promise((resolve) => {
      resolvers.push(resolve)
    }))

    const first = useSessionStore.getState().fetchMessages('session-a')
    const recovery = useSessionStore.getState().fetchMessages(
      'session-a',
      undefined,
      { queueIfInFlight: true },
    )

    expect(wsMock.request).toHaveBeenCalledTimes(1)
    resolvers[0]?.([])
    await vi.waitFor(() => expect(wsMock.request).toHaveBeenCalledTimes(2))

    resolvers[1]?.([])
    await Promise.all([first, recovery])
    expect(useSessionStore.getState().messagesLoadingSessionId).toBeNull()
  })
})
