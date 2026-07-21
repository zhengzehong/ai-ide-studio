import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultCaps } from '../../ui/src/stores/session-events.ts'

const wsMock = vi.hoisted(() => ({
  handlers: new Map<string, Set<(msg: Record<string, unknown>) => void>>(),
  request: vi.fn(async () => null),
  send: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  on: vi.fn(),
}))
const commandMock = vi.hoisted(() => ({ execute: vi.fn() }))

vi.mock('../../ui/src/services/ws-client', () => ({
  wsClient: wsMock,
}))
vi.mock('../../ui/src/services/command-client', () => ({
  commandClient: commandMock,
  toCommandImages: (images?: Array<{ data?: string; mimeType: string }>) => images,
}))

const { useGlobalAssistantStore } = await import('../../ui/src/stores/global-assistant.store.ts')
const { useProjectStore } = await import('../../ui/src/stores/project.store.ts')

function resetStore(): void {
  useGlobalAssistantStore.setState({
    assistant: null,
    agent: null,
    session: null,
    open: false,
    loading: false,
    settingTemplateIds: {},
    messages: [],
    events: [],
    streamingMessage: null,
    usage: null,
    turnUsage: null,
    capabilities: { ...defaultCaps },
    plan: [],
    pendingPermissions: [],
    pendingElicitations: [],
    hasMoreMessages: false,
    loadingOlderMessages: false,
    running: false,
    stopping: false,
    stopError: null,
    unread: false,
    error: null,
    fileChangeDetailsByMessageId: {},
    toolCallLoadingByKey: {},
    toolCallErrorByKey: {},
    turnProcessLoadingByMessageId: {},
    turnProcessErrorByMessageId: {},
    processItemLoadingByKey: {},
    processItemErrorByKey: {},
  })
  useProjectStore.setState({
    projects: [],
    currentProjectId: null,
    loading: false,
  })
}

describe('global assistant store', () => {
  beforeEach(() => {
    resetStore()
    wsMock.request.mockReset()
    wsMock.send.mockReset()
    wsMock.subscribe.mockReset()
    wsMock.unsubscribe.mockReset()
    wsMock.on.mockReset()
    wsMock.handlers.clear()
    wsMock.on.mockImplementation((event: string, handler: (msg: Record<string, unknown>) => void) => {
      if (!wsMock.handlers.has(event)) wsMock.handlers.set(event, new Set())
      wsMock.handlers.get(event)?.add(handler)
      return () => wsMock.handlers.get(event)?.delete(handler)
    })
    commandMock.execute.mockReset()
    commandMock.execute.mockResolvedValue({ commandId: 'command-1', status: 'accepted', duplicate: false })
  })

  test('binds a template and subscribes to its fixed session', async () => {
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type === 'globalAssistant.setTemplate') {
        return {
          assistant: {
            id: 'default',
            agent_id: 'agent-global',
            session_id: 'sess-global',
            workspace_dir: 'D:/data/global-assistant/workspace',
            enabled: 1,
            created_at: '2026-06-10T00:00:00.000Z',
            updated_at: '2026-06-10T00:00:00.000Z',
            last_opened_at: null,
          },
          agent: {
            id: 'agent-global',
            type: 'pm',
            name: '知识助理',
            runtime: 'mock',
            status: 'standby',
            permission_level: 3,
            config_json: null,
            created_at: '2026-06-10T00:00:00.000Z',
            project_id: null,
            template_id: 'tpl-1',
            system_prompt: '整理知识',
            icon: 'bot',
          },
          session: {
            id: 'sess-global',
            agent_id: 'agent-global',
            task_id: null,
            acp_session_id: null,
            status: 'active',
            stage: '',
            started_at: '2026-06-10T00:00:00.000Z',
            closed_at: null,
            project_id: null,
            title: '全局助理',
          },
        }
      }
      if (msg.type === 'sessions.messages') return []
      if (msg.type === 'session.getModels') return { models: [], modes: [], configOptions: [], commands: [], supportsImages: true }
      return null
    })

    await useGlobalAssistantStore.getState().setFromTemplate('tpl-1', { modelProfileId: 'mpf-1' })

    expect(wsMock.request).toHaveBeenCalledWith({ type: 'globalAssistant.setTemplate', templateId: 'tpl-1', modelProfileId: 'mpf-1' })
    expect(wsMock.subscribe).toHaveBeenCalledWith(['sess-global'])
    expect(useGlobalAssistantStore.getState().agent?.name).toBe('知识助理')
    expect(useGlobalAssistantStore.getState().session?.id).toBe('sess-global')
    expect(useGlobalAssistantStore.getState().capabilities.supportsImages).toBe(true)
  })

  test('loads the binding without starting runtime capabilities until opened', async () => {
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type === 'globalAssistant.get') {
        return {
          assistant: {
            id: 'default',
            agent_id: 'agent-global',
            session_id: 'sess-global',
            workspace_dir: 'D:/data/global-assistant/workspace',
            enabled: 1,
            created_at: '2026-06-10T00:00:00.000Z',
            updated_at: '2026-06-10T00:00:00.000Z',
            last_opened_at: null,
          },
          agent: {
            id: 'agent-global',
            type: 'pm',
            name: '知识助理',
            runtime: 'mock',
            status: 'standby',
            permission_level: 3,
            config_json: null,
            created_at: '2026-06-10T00:00:00.000Z',
            project_id: null,
            template_id: 'tpl-1',
            system_prompt: '整理知识',
            icon: 'bot',
          },
          session: {
            id: 'sess-global',
            agent_id: 'agent-global',
            task_id: null,
            acp_session_id: null,
            status: 'active',
            stage: '',
            started_at: '2026-06-10T00:00:00.000Z',
            closed_at: null,
            project_id: null,
            title: '全局助理',
          },
        }
      }
      if (msg.type === 'sessions.messages') return []
      if (msg.type === 'session.getModels') return { models: [], modes: [], configOptions: [], commands: [], supportsImages: true }
      return null
    })

    await useGlobalAssistantStore.getState().load()

    expect(wsMock.request).not.toHaveBeenCalledWith({ type: 'session.getModels', sessionId: 'sess-global' })

    await useGlobalAssistantStore.getState().openDrawer()

    expect(wsMock.request).toHaveBeenCalledWith({ type: 'session.getModels', sessionId: 'sess-global' })
  })

  test('sends current project context with global assistant prompts', async () => {
    useGlobalAssistantStore.setState({
      session: {
        id: 'sess-global',
        agent_id: 'agent-global',
        task_id: null,
        acp_session_id: null,
        status: 'active',
        stage: '',
        started_at: '2026-06-10T00:00:00.000Z',
        closed_at: null,
        project_id: null,
        title: '全局助理',
      },
    })
    useProjectStore.setState({ currentProjectId: 'proj-current' })

    await useGlobalAssistantStore.getState().sendPrompt('创建当前项目的定时任务')

    expect(commandMock.execute).toHaveBeenCalledWith(expect.objectContaining({
      type: 'prompt',
      sessionId: 'sess-global',
      content: '创建当前项目的定时任务',
      contextProjectId: 'proj-current',
    }))
  })

  test('deduplicates cancellation and enters stopping state immediately', async () => {
    let complete: (() => void) | undefined
    commandMock.execute.mockImplementation(() => new Promise((resolve) => {
      complete = () => resolve({ commandId: 'cancel-1', status: 'completed', duplicate: false })
    }))
    useGlobalAssistantStore.setState({
      session: sessionFixture('sess-global'),
      running: true,
      streamingMessage: streamingFixture('agent-message-global'),
    })

    const first = useGlobalAssistantStore.getState().cancelTurn()
    const second = useGlobalAssistantStore.getState().cancelTurn()

    expect(first).toBe(second)
    expect(useGlobalAssistantStore.getState().stopping).toBe(true)
    expect(commandMock.execute).toHaveBeenCalledTimes(1)
    expect(commandMock.execute).toHaveBeenCalledWith(expect.objectContaining({
      commandId: expect.stringContaining('agent-message-global'),
      type: 'session.cancel',
    }))

    complete?.()
    await first
  })

  test('keeps the assistant running and shows an error when cancellation fails', async () => {
    commandMock.execute.mockRejectedValue(new Error('cancel failed'))
    useGlobalAssistantStore.setState({
      session: sessionFixture('sess-global-failed'),
      running: true,
      streamingMessage: streamingFixture('agent-message-global-failed'),
    })

    await expect(useGlobalAssistantStore.getState().cancelTurn()).rejects.toThrow('cancel failed')

    expect(useGlobalAssistantStore.getState().stopping).toBe(false)
    expect(useGlobalAssistantStore.getState().running).toBe(true)
    expect(useGlobalAssistantStore.getState().stopError).toContain('cancel failed')
  })

  test('waits for cancellation before sending a replacement assistant prompt', async () => {
    let completeCancel: (() => void) | undefined
    commandMock.execute.mockImplementation((command: { type: string }) => {
      if (command.type === 'session.cancel') {
        return new Promise((resolve) => {
          completeCancel = () => resolve({ commandId: 'cancel-queued', status: 'completed', duplicate: false })
        })
      }
      return Promise.resolve({ commandId: 'prompt-after-cancel', status: 'accepted', duplicate: false })
    })
    useGlobalAssistantStore.setState({
      session: sessionFixture('sess-global-queued'),
      running: true,
      streamingMessage: streamingFixture('agent-message-global-queued'),
    })

    const cancellation = useGlobalAssistantStore.getState().cancelTurn()
    const replacement = useGlobalAssistantStore.getState().sendPrompt('replacement')

    expect(commandMock.execute).toHaveBeenCalledTimes(1)
    expect(useGlobalAssistantStore.getState().messages).toHaveLength(0)

    completeCancel?.()
    await cancellation
    await replacement

    expect(commandMock.execute).toHaveBeenCalledTimes(2)
    expect(useGlobalAssistantStore.getState().messages[0]?.content).toBe('replacement')
    expect(useGlobalAssistantStore.getState().stopping).toBe(false)
  })

  test('clears stopping when the assistant receives a terminal event', () => {
    useGlobalAssistantStore.setState({
      session: sessionFixture('sess-global-done'),
      running: true,
      stopping: true,
      stopError: 'old error',
    })
    const cleanup = useGlobalAssistantStore.getState().setupListeners()

    try {
      for (const handler of wsMock.handlers.get('session:done') ?? []) {
        handler({ sessionId: 'sess-global-done', messageId: 'message-1', stopReason: 'cancelled' })
      }
      expect(useGlobalAssistantStore.getState().stopping).toBe(false)
      expect(useGlobalAssistantStore.getState().stopError).toBeNull()
    } finally {
      cleanup()
    }
  })
})

function sessionFixture(id: string) {
  return {
    id,
    agent_id: 'agent-global',
    task_id: null,
    acp_session_id: null,
    status: 'active',
    stage: '',
    started_at: '2026-06-10T00:00:00.000Z',
    closed_at: null,
    project_id: null,
    title: 'Global assistant',
  }
}

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
