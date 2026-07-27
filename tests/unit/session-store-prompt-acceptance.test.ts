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
const queryMock = vi.hoisted(() => ({
  listSessionMessages: vi.fn(() => new Promise(() => undefined)),
  getSessionRecovery: vi.fn(() => new Promise(() => undefined)),
}))

vi.mock('../../ui/src/services/command-client', () => ({
  commandClient: commandMock,
  toCommandImages: (images?: Array<{ data?: string; mimeType: string }>) => images,
}))
vi.mock('../../ui/src/services/ws-client', () => ({ wsClient: wsMock }))
vi.mock('../../ui/src/services/query-client', () => ({ queryClient: queryMock }))

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
    interactionErrorsBySession: {},
    runningSessionIds: {},
    stoppingSessionIds: {},
    stopErrorsBySession: {},
    unreadSessionIds: {},
    staleSessionIds: {},
  })
  commandMock.execute.mockReset()
  wsMock.request.mockReset()
}

describe('Session Prompt acceptance boundary', () => {
  beforeEach(resetStore)

  it('keeps a confirmed Claude config selection without waiting for a capability event', async () => {
    wsMock.request.mockResolvedValueOnce({ configId: 'effort', value: 'max' })
    useSessionStore.setState({
      capabilities: {
        ...defaultCaps,
        configOptions: [{
          id: 'effort',
          name: 'Effort',
          type: 'select',
          currentValue: 'default',
          options: [{ value: 'default', name: 'Default' }, { value: 'max', name: 'Max' }],
        }],
      },
    })

    await useSessionStore.getState().setConfig('effort', 'max')

    expect(useSessionStore.getState().capabilities.configOptions[0]?.currentValue).toBe('max')
  })

  it('shows a config selection while the server request is still pending', async () => {
    let accept: (() => void) | undefined
    wsMock.request.mockImplementationOnce(() => new Promise((resolve) => {
      accept = () => resolve({ configId: 'effort', value: 'max' })
    }))
    useSessionStore.setState({
      capabilities: {
        ...defaultCaps,
        configOptions: [{ id: 'effort', name: 'Effort', type: 'select', currentValue: 'default' }],
      },
    })

    const request = useSessionStore.getState().setConfig('effort', 'max')

    expect(useSessionStore.getState().capabilities.configOptions[0]?.currentValue).toBe('max')
    accept?.()
    await request
  })

  it('restores the previous config when the server rejects the selection', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    wsMock.request.mockRejectedValueOnce(new Error('set config failed'))
    useSessionStore.setState({
      capabilities: {
        ...defaultCaps,
        configOptions: [{ id: 'effort', name: 'Effort', type: 'select', currentValue: 'default' }],
      },
    })

    await useSessionStore.getState().setConfig('effort', 'max')

    expect(useSessionStore.getState().capabilities.configOptions[0]?.currentValue).toBe('default')
    errorSpy.mockRestore()
  })

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

  it('removes an expired permission card and exposes an actionable error', async () => {
    useSessionStore.setState({
      pendingPermissions: [{
        id: 'permission-1',
        toolCall: { id: 'tool-1', title: 'Terminal' },
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      }],
    })
    commandMock.execute.mockRejectedValue(new Error('权限请求已失效'))

    await useSessionStore.getState().respondPermission('permission-1', 'allow')

    expect(useSessionStore.getState().pendingPermissions).toEqual([])
    expect(useSessionStore.getState().interactionErrorsBySession['session-1'])
      .toBe('权限请求已失效，请重新发送消息')
  })

  it('keeps a permission card when a retryable response fails', async () => {
    const permission = {
      id: 'permission-1',
      toolCall: { id: 'tool-1', title: 'Terminal' },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    }
    useSessionStore.setState({ pendingPermissions: [permission] })
    commandMock.execute.mockRejectedValue(new Error('网络不可用'))

    await useSessionStore.getState().respondPermission('permission-1', 'allow')

    expect(useSessionStore.getState().pendingPermissions).toEqual([permission])
    expect(useSessionStore.getState().interactionErrorsBySession['session-1'])
      .toBe('权限响应失败：网络不可用')
  })

  it('keeps Session B intact and removes a completed permission from Session A cache', async () => {
    let complete: (() => void) | undefined
    commandMock.execute.mockImplementation((command: { type: string }) => {
      if (command.type !== 'permission.respond')
        return Promise.resolve({ commandId: 'other', status: 'completed', duplicate: false })
      return new Promise((resolve) => {
        complete = () => resolve({ commandId: 'permission-a', status: 'completed', duplicate: false })
      })
    })
    const permissionA = {
      id: 'permission-a',
      toolCall: { id: 'tool-a', title: 'Terminal A' },
      options: [{ optionId: 'allow-a', name: 'Allow', kind: 'allow_once' as const }],
    }
    const permissionB = {
      id: 'permission-b',
      toolCall: { id: 'tool-b', title: 'Terminal B' },
      options: [{ optionId: 'allow-b', name: 'Allow', kind: 'allow_once' as const }],
    }
    useSessionStore.setState({ currentSessionId: 'session-switch-a', pendingPermissions: [permissionA] })

    const response = useSessionStore.getState().respondPermission('permission-a', 'allow-a')
    useSessionStore.getState().selectSession('session-switch-b')
    useSessionStore.setState({ pendingPermissions: [permissionB] })
    complete?.()
    await response

    expect(useSessionStore.getState().currentSessionId).toBe('session-switch-b')
    expect(useSessionStore.getState().pendingPermissions).toEqual([permissionB])
    expect(useSessionStore.getState().interactionErrorsBySession['session-switch-b']).toBeUndefined()

    useSessionStore.getState().selectSession('session-switch-a')
    expect(useSessionStore.getState().pendingPermissions).toEqual([])
  })

  it('keeps Session B intact when Session A permission response fails', async () => {
    let rejectResponse: ((error: Error) => void) | undefined
    commandMock.execute.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectResponse = reject
    }))
    const permissionA = {
      id: 'permission-race-a',
      toolCall: { id: 'tool-race-a', title: 'Terminal A' },
      options: [{ optionId: 'allow-a', name: 'Allow', kind: 'allow_once' as const }],
    }
    const permissionB = {
      id: 'permission-race-a',
      toolCall: { id: 'tool-race-b', title: 'Terminal B' },
      options: [{ optionId: 'allow-b', name: 'Allow', kind: 'allow_once' as const }],
    }
    useSessionStore.setState({ currentSessionId: 'session-race-a', pendingPermissions: [permissionA] })

    const response = useSessionStore.getState().respondPermission('permission-race-a', 'allow-a')
    useSessionStore.setState({ currentSessionId: 'session-race-b', pendingPermissions: [permissionB] })
    rejectResponse?.(new Error('权限请求已失效'))
    await response

    expect(useSessionStore.getState().pendingPermissions).toEqual([permissionB])
    expect(useSessionStore.getState().interactionErrorsBySession['session-race-b']).toBeUndefined()
    expect(useSessionStore.getState().interactionErrorsBySession['session-race-a'])
      .toBe('权限请求已失效，请重新发送消息')
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

    expect(useSessionStore.getState().stoppingSessionIds['session-1']).toBeUndefined()
    expect(useSessionStore.getState().runningSessionIds['session-1']).toBeUndefined()
    expect(useSessionStore.getState().streamingMessage).toBeNull()
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
