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

function event(
  id: string,
  type: string,
  sequence: number,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    session_id: 'session-a',
    agent_id: 'agent-a',
    acp_session_id: null,
    message_id: null,
    type,
    role: null,
    payload_json: JSON.stringify(payload),
    sequence,
    created_at: '2026-07-21T00:00:00.000Z',
  }
}

describe('session recovery store', () => {
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
    })
  })

  test('applies lightweight state events without restoring mirrored tool output', async () => {
    wsMock.request.mockResolvedValue([
      event('event-tool', 'tool.update', 1, { rawOutput: 'large output' }),
      event('event-config', 'config.update', 2, {
        configOptions: [{
          id: 'mode',
          name: '模式',
          type: 'select',
          category: 'mode',
          currentValue: 'plan',
          options: [{ value: 'plan', name: '规划' }],
        }],
      }),
      event('event-permission', 'permission.request', 3, {
        permissionRequest: { id: 'permission-a', title: '允许读取文件', options: [] },
      }),
    ])

    await useSessionStore.getState().fetchRecovery('session-a')

    expect(useSessionStore.getState().events.map((item) => item.type)).toEqual([
      'config.update',
      'permission.request',
    ])
    expect(useSessionStore.getState().capabilities.currentModeId).toBe('plan')
    expect(useSessionStore.getState().pendingPermissions.map((item) => item.id))
      .toEqual(['permission-a'])
    expect(useSessionStore.getState().streamingMessage).toBeNull()
  })

  test('does not let historical config overwrite Runtime capabilities', async () => {
    useSessionStore.setState({ currentSessionId: 'session-live' })
    wsMock.request
      .mockResolvedValueOnce({
        configOptions: [{
          id: 'effort',
          name: 'Effort',
          type: 'select',
          category: 'thought_level',
          currentValue: 'max',
          options: [
            { value: 'default', name: 'Default' },
            { value: 'max', name: 'Max' },
          ],
        }],
      })
      .mockResolvedValueOnce([
        event('event-config-default', 'config.update', 10, {
          configOptions: [{
            id: 'effort',
            name: 'Effort',
            type: 'select',
            category: 'thought_level',
            currentValue: 'default',
            options: [
              { value: 'default', name: 'Default' },
              { value: 'max', name: 'Max' },
            ],
          }],
        }),
      ])

    await useSessionStore.getState().fetchModels()
    await useSessionStore.getState().fetchRecovery('session-live')

    expect(useSessionStore.getState().capabilities.configOptions)
      .toContainEqual(expect.objectContaining({ id: 'effort', currentValue: 'max' }))
  })

  test('ignores a Runtime capability response for a Session that is no longer selected', async () => {
    let resolveModels: ((value: unknown) => void) | undefined
    wsMock.request.mockImplementationOnce(() => new Promise((resolve) => {
      resolveModels = resolve
    }))
    useSessionStore.setState({ currentSessionId: 'session-old' })
    const request = useSessionStore.getState().fetchModels()
    useSessionStore.setState({
      currentSessionId: 'session-new',
      capabilities: { ...defaultCaps },
    })

    resolveModels?.({ currentModelId: 'model-from-old-session' })
    await request

    expect(useSessionStore.getState().capabilities.currentModelId).toBeNull()
  })
})
