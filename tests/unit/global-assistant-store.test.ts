import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultCaps } from '../../ui/src/stores/session-events.ts'

const wsMock = vi.hoisted(() => ({
  request: vi.fn(async () => null),
  send: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  on: vi.fn(() => () => undefined),
}))

vi.mock('../../ui/src/services/ws-client', () => ({
  wsClient: wsMock,
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
    wsMock.on.mockReturnValue(() => undefined)
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

  test('sends current project context with global assistant prompts', () => {
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

    useGlobalAssistantStore.getState().sendPrompt('创建当前项目的定时任务')

    expect(wsMock.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'prompt',
      sessionId: 'sess-global',
      content: '创建当前项目的定时任务',
      contextProjectId: 'proj-current',
    }))
  })
})
