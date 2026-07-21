import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultCaps } from '../../ui/src/stores/session-events.ts'

const commandMock = vi.hoisted(() => ({ execute: vi.fn() }))
const wsMock = vi.hoisted(() => ({
  on: vi.fn(() => () => undefined),
  request: vi.fn(async () => []),
  send: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('../../ui/src/services/command-client', () => ({
  commandClient: commandMock,
  toCommandImages: (images?: Array<{ data?: string; mimeType: string }>) => images,
}))
vi.mock('../../ui/src/services/ws-client', () => ({ wsClient: wsMock }))

const { useSessionStore } = await import('../../ui/src/stores/session.store.ts')

function resetStore(): void {
  useSessionStore.setState({
    sessions: [{
      id: 'session-1',
      agent_id: 'agent-1',
      task_id: null,
      acp_session_id: null,
      status: 'active',
      stage: '',
      started_at: '2026-07-20T00:00:00.000Z',
      closed_at: null,
      project_id: 'project-1',
    }],
    currentSessionId: 'session-1',
    messages: [],
    events: [],
    streamingMessage: null,
    usage: null,
    turnUsage: null,
    capabilities: { ...defaultCaps },
    plan: [],
    pendingPermissions: [],
    pendingElicitations: [],
    runningSessionIds: {},
    stoppingSessionIds: {},
    stopErrorsBySession: {},
    unreadSessionIds: {},
    staleSessionIds: {},
  })
  commandMock.execute.mockReset()
}

describe('Session Prompt acceptance boundary', () => {
  beforeEach(resetStore)

  it('returns a Promise and keeps optimistic state after the server accepts the command', async () => {
    let accept: (() => void) | undefined
    commandMock.execute.mockImplementation(() => new Promise((resolve) => {
      accept = () => resolve({ commandId: 'command-1', status: 'accepted', duplicate: false })
    }))

    const submission = useSessionStore.getState().sendPrompt('hello')

    expect(submission).toBeInstanceOf(Promise)
    expect(useSessionStore.getState().messages).toHaveLength(1)
    expect(useSessionStore.getState().runningSessionIds['session-1']).toBe(true)
    accept?.()
    await submission
    expect(useSessionStore.getState().messages[0]?.content).toBe('hello')
  })

  it('removes only its optimistic turn and running state when acceptance fails', async () => {
    let reject: ((error: Error) => void) | undefined
    commandMock.execute.mockImplementation(() => new Promise((_resolve, rejectPromise) => {
      reject = rejectPromise
    }))

    const submission = useSessionStore.getState().sendPrompt('hello', [{ data: 'YWJj', mimeType: 'image/png' }])

    expect(submission).toBeInstanceOf(Promise)
    if (!(submission instanceof Promise)) return
    reject?.(new Error('命令服务暂不可用'))
    await expect(submission).rejects.toThrow('命令服务暂不可用')
    expect(useSessionStore.getState().messages).toEqual([])
    expect(useSessionStore.getState().streamingMessage).toBeNull()
    expect(useSessionStore.getState().runningSessionIds['session-1']).toBeUndefined()
  })

  it('marks cancellation immediately and deduplicates repeated clicks for the active turn', async () => {
    let complete: (() => void) | undefined
    commandMock.execute.mockImplementation(() => new Promise((resolve) => {
      complete = () => resolve({ commandId: 'cancel-1', status: 'completed', duplicate: false })
    }))
    useSessionStore.setState({
      runningSessionIds: { 'session-1': true },
      streamingMessage: streamingFixture('agent-message-1'),
    })

    const first = useSessionStore.getState().cancelTurn()
    const second = useSessionStore.getState().cancelTurn()

    expect(first).toBe(second)
    expect(useSessionStore.getState().stoppingSessionIds['session-1']).toBe(true)
    expect(commandMock.execute).toHaveBeenCalledTimes(1)
    expect(commandMock.execute).toHaveBeenCalledWith(expect.objectContaining({
      commandId: expect.stringContaining('agent-message-1'),
      type: 'session.cancel',
      sessionId: 'session-1',
    }))

    complete?.()
    await first
  })

  it('clears stopping, preserves running, and exposes an error when cancellation fails', async () => {
    commandMock.execute.mockRejectedValue(new Error('cancel failed'))
    useSessionStore.setState({
      runningSessionIds: { 'session-1': true },
      streamingMessage: streamingFixture('agent-message-failed-cancel'),
    })

    await expect(useSessionStore.getState().cancelTurn()).rejects.toThrow('cancel failed')

    expect(useSessionStore.getState().stoppingSessionIds['session-1']).toBeUndefined()
    expect(useSessionStore.getState().runningSessionIds['session-1']).toBe(true)
    expect(useSessionStore.getState().stopErrorsBySession['session-1']).toContain('cancel failed')
  })

  it('waits for an in-flight cancellation before accepting a replacement prompt', async () => {
    let completeCancel: (() => void) | undefined
    commandMock.execute.mockImplementation((command: { type: string }) => {
      if (command.type === 'session.cancel') {
        return new Promise((resolve) => {
          completeCancel = () => resolve({ commandId: 'cancel-queued', status: 'completed', duplicate: false })
        })
      }
      return Promise.resolve({ commandId: 'prompt-after-cancel', status: 'accepted', duplicate: false })
    })
    useSessionStore.setState({
      runningSessionIds: { 'session-1': true },
      streamingMessage: streamingFixture('agent-message-before-replacement'),
    })

    const cancellation = useSessionStore.getState().cancelTurn()
    const replacement = useSessionStore.getState().sendPrompt('replacement')

    expect(commandMock.execute).toHaveBeenCalledTimes(1)
    expect(useSessionStore.getState().messages).toHaveLength(0)

    completeCancel?.()
    await cancellation
    await replacement

    expect(commandMock.execute).toHaveBeenCalledTimes(2)
    expect(commandMock.execute.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      type: 'prompt',
      content: 'replacement',
    }))
    expect(useSessionStore.getState().messages[0]?.content).toBe('replacement')
    expect(useSessionStore.getState().stoppingSessionIds['session-1']).toBeUndefined()
  })
})

function streamingFixture(id: string) {
  return {
    id,
    role: 'agent' as const,
    content: '',
    thinking: '',
    toolCalls: [],
    processBlocks: [],
    finalAnswer: '',
    done: false,
  }
}
