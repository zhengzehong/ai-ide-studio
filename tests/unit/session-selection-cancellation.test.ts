import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultCaps } from '../../ui/src/stores/session-events.ts'

interface MessageQueryInput {
  sessionId: string
  signal?: AbortSignal
}

interface RecoveryQueryInput {
  sessionId: string
  signal?: AbortSignal
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

const wsMock = vi.hoisted(() => ({
  on: vi.fn(() => () => undefined),
  request: vi.fn(async () => []),
  send: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}))
const commandMock = vi.hoisted(() => ({
  execute: vi.fn(async () => ({ commandId: 'read', status: 'completed', duplicate: false })),
}))
const queryMock = vi.hoisted(() => ({
  listSessionMessages: vi.fn(),
  getSessionRecovery: vi.fn(),
}))

vi.mock('../../ui/src/services/ws-client', () => ({ wsClient: wsMock }))
vi.mock('../../ui/src/services/command-client', () => ({
  commandClient: commandMock,
  toCommandImages: (images?: unknown[]) => images,
}))
vi.mock('../../ui/src/services/query-client', () => ({ queryClient: queryMock }))

const { useSessionStore } = await import('../../ui/src/stores/session.store.ts')

describe('Session selection query cancellation', () => {
  beforeEach(() => {
    queryMock.listSessionMessages.mockReset()
    queryMock.getSessionRecovery.mockReset()
    wsMock.request.mockClear()
    wsMock.subscribe.mockClear()
    wsMock.unsubscribe.mockClear()
    useSessionStore.setState({
      currentSessionId: null,
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
      runningSessionIds: {},
      staleSessionIds: {},
    })
  })

  test('aborts the previous selection and rejects its late response', async () => {
    const messages = new Map<string, Deferred<{ items: Array<Record<string, unknown>>; hasMore: boolean }>>()
    const recoveries = new Map<string, Deferred<Record<string, unknown>>>()
    queryMock.listSessionMessages.mockImplementation((input: MessageQueryInput) => {
      const pending = deferred<{ items: Array<Record<string, unknown>>; hasMore: boolean }>()
      messages.set(input.sessionId, pending)
      return pending.promise
    })
    queryMock.getSessionRecovery.mockImplementation((input: RecoveryQueryInput) => {
      const pending = deferred<Record<string, unknown>>()
      recoveries.set(input.sessionId, pending)
      return pending.promise
    })

    useSessionStore.getState().selectSession('selection-a')
    const firstMessageSignal = (queryMock.listSessionMessages.mock.calls[0]?.[0] as MessageQueryInput).signal
    const firstRecoverySignal = (queryMock.getSessionRecovery.mock.calls[0]?.[0] as RecoveryQueryInput).signal
    useSessionStore.getState().selectSession('selection-b')

    expect(firstMessageSignal?.aborted).toBe(true)
    expect(firstRecoverySignal?.aborted).toBe(true)

    messages.get('selection-b')?.resolve({
      items: [message('message-b', 'selection-b', 'current')],
      hasMore: false,
    })
    recoveries.get('selection-b')?.resolve({
      sessionId: 'selection-b',
      latestSequence: 2,
      events: [event('event-b', 'selection-b', 2)],
    })
    await flushPromises()

    messages.get('selection-a')?.resolve({
      items: [message('message-a-late', 'selection-a', 'stale')],
      hasMore: false,
    })
    recoveries.get('selection-a')?.resolve({
      sessionId: 'selection-a',
      latestSequence: 1,
      events: [event('event-a-late', 'selection-a', 1)],
    })
    await flushPromises()

    expect(useSessionStore.getState().currentSessionId).toBe('selection-b')
    expect(useSessionStore.getState().messages.map((item) => item.id)).toEqual(['message-b'])
    expect(useSessionStore.getState().events.map((item) => item.id)).toEqual(['event-b'])
  })
})

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve })
  return {
    promise,
    resolve(value): void {
      resolvePromise?.(value)
    },
  }
}

function message(id: string, sessionId: string, content: string): Record<string, unknown> {
  return {
    id,
    session_id: sessionId,
    role: 'agent',
    content,
    thinking: null,
    tool_calls_json: null,
    decision_json: null,
    attachments_json: null,
    timestamp: '2026-07-22T00:00:00.000Z',
    status: 'completed',
  }
}

function event(id: string, sessionId: string, sequence: number): Record<string, unknown> {
  return {
    id,
    session_id: sessionId,
    agent_id: 'agent-a',
    acp_session_id: null,
    message_id: null,
    type: 'session:capabilities',
    role: 'system',
    payload_json: '{}',
    sequence,
    created_at: '2026-07-22T00:00:00.000Z',
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
