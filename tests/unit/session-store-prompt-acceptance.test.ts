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
})
