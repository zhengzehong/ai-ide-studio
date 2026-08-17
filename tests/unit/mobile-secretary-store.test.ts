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
  chatSessionId: 'session-chat',
  enabled: true,
  observeAll: true,
  observedAgentIds: [],
  triggers: [{ id: 'trigger-1', type: 'session_done', cron: null, enabled: true }],
  lastRunAt: null,
  lastError: null,
  unreadCount: 0,
}

beforeEach(() => {
  vi.restoreAllMocks()
  useMobileSecretaryStore.setState({
    projectId: 'project-1',
    secretaries: [secretary],
    selectedId: secretary.id,
    threads: [],
    loading: false,
    saving: false,
    error: '',
  })
})

describe('mobile secretary store', () => {
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
