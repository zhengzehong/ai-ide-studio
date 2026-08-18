import { beforeEach, describe, expect, test, vi } from 'vitest'
import { wsClient } from '@desktop/services/ws-client'
import { useMobileSecretaryStore, type MobileSecretary, type MobileSecretaryThread } from '../../mobile/src/stores/secretary.store'

const secretary: MobileSecretary = {
  id: 'secretary-1',
  projectId: 'project-1',
  name: '研发秘书',
  definitionPrompt: '关注研发进展',
  reportPrompt: '只汇报重要变化',
  executionAgentId: 'agent-1',
  runtimeSessionId: 'session-runtime',
  chatSessionId: 'session-chat',
  enabled: true,
  observeAll: true,
  observedAgentIds: [],
  triggers: [{ id: 'trigger-1', type: 'session_done', cron: null, enabled: true }],
  lastRunAt: null,
  lastError: null,
  unreadCount: 0,
  chatUnread: false,
}

beforeEach(() => {
  vi.restoreAllMocks()
  useMobileSecretaryStore.setState({
    projectId: 'project-1',
    secretaries: [secretary],
    selectedId: secretary.id,
    threads: [],
    runs: [],
    loading: false,
    runsLoading: false,
    saving: false,
    error: '',
  })
})

describe('mobile secretary store', () => {
  test('loads mail and recent execution history together', async () => {
    const request = vi.spyOn(wsClient, 'request')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'run-1', status: 'succeeded', eventType: 'cron' }])

    await useMobileSecretaryStore.getState().select('project-1', secretary.id)

    expect(request).toHaveBeenNthCalledWith(1, {
      type: 'secretary.threads.list', projectId: 'project-1', secretaryId: secretary.id,
    })
    expect(request).toHaveBeenNthCalledWith(2, {
      type: 'secretary.runs.list', projectId: 'project-1', secretaryId: secretary.id, limit: 20,
    })
    expect(useMobileSecretaryStore.getState().runs).toEqual([
      expect.objectContaining({ id: 'run-1', status: 'succeeded' }),
    ])
  })

  test('ignores stale detail responses after the user switches secretaries', async () => {
    const second = { ...secretary, id: 'secretary-2', name: '交付秘书' }
    useMobileSecretaryStore.setState({ secretaries: [secretary, second] })
    const firstThreads = deferred<MobileSecretaryThread[]>()
    const firstRuns = deferred<unknown[]>()
    const secondThreads = deferred<MobileSecretaryThread[]>()
    const secondRuns = deferred<unknown[]>()
    vi.spyOn(wsClient, 'request').mockImplementation((message) => {
      const isFirst = message.secretaryId === secretary.id
      const isRuns = message.type === 'secretary.runs.list'
      return (isFirst ? (isRuns ? firstRuns.promise : firstThreads.promise) : (isRuns ? secondRuns.promise : secondThreads.promise))
    })

    const firstSelection = useMobileSecretaryStore.getState().select('project-1', secretary.id)
    const secondSelection = useMobileSecretaryStore.getState().select('project-1', second.id)
    secondThreads.resolve([])
    secondRuns.resolve([{ id: 'run-second', status: 'succeeded' }])
    await secondSelection
    firstThreads.resolve([])
    firstRuns.resolve([{ id: 'run-first', status: 'running' }])
    await firstSelection

    expect(useMobileSecretaryStore.getState()).toMatchObject({
      selectedId: second.id,
      runs: [{ id: 'run-second', status: 'succeeded' }],
    })
  })

  test('updates a secretary through the shared RPC', async () => {
    const updated = { ...secretary, name: '交付秘书', enabled: false }
    const request = vi.spyOn(wsClient, 'request').mockResolvedValue(updated)

    await useMobileSecretaryStore.getState().update('project-1', secretary.id, { name: updated.name, enabled: false })

    expect(request).toHaveBeenCalledWith({
      type: 'secretary.update',
      projectId: 'project-1',
      secretaryId: secretary.id,
      name: updated.name,
      enabled: false,
    })
    expect(useMobileSecretaryStore.getState()).toMatchObject({ secretaries: [updated], saving: false })
  })

  test('removes the selected secretary without leaving stale mail', async () => {
    const request = vi.spyOn(wsClient, 'request').mockResolvedValue({ deleted: true })
    const thread: MobileSecretaryThread = {
      id: 'thread-1', secretaryId: secretary.id, subject: '进展', summary: '', kind: 'progress',
      needsAction: false, unread: true, bodyMarkdown: '完成', attachments: [], updatedAt: '2026-08-17T00:00:00.000Z',
    }
    useMobileSecretaryStore.setState({ threads: [thread] })

    await useMobileSecretaryStore.getState().remove('project-1', secretary.id)

    expect(request).toHaveBeenCalledWith({ type: 'secretary.delete', projectId: 'project-1', secretaryId: secretary.id })
    expect(useMobileSecretaryStore.getState()).toMatchObject({ secretaries: [], selectedId: null, threads: [] })
  })

  test('keeps mail visible when archive fails', async () => {
    const thread: MobileSecretaryThread = {
      id: 'thread-1', secretaryId: secretary.id, subject: '进展', summary: '', kind: 'progress',
      needsAction: false, unread: true, bodyMarkdown: '完成', attachments: [], updatedAt: '2026-08-17T00:00:00.000Z',
    }
    useMobileSecretaryStore.setState({ threads: [thread] })
    vi.spyOn(wsClient, 'request').mockRejectedValue(new Error('连接断开'))

    await expect(useMobileSecretaryStore.getState().archive('project-1', secretary.id, thread.id))
      .rejects.toThrow('连接断开')

    expect(useMobileSecretaryStore.getState().threads).toEqual([thread])
    expect(useMobileSecretaryStore.getState().error).toBe('连接断开')
  })
})

function deferred<T>() {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve })
  return { promise, resolve: resolvePromise }
}
