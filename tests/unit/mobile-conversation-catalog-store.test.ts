import { afterEach, describe, expect, it, vi } from 'vitest'
import { wsClient } from '../../ui/src/services/ws-client'
import { useConversationCatalog } from '../../mobile/src/stores/conversation-catalog.store'
import { useConnectionStore } from '../../mobile/src/stores/connection.store'

const empty = { teams: [], conversations: [], hiddenAgentIds: [], hiddenSessionIds: [] }
afterEach(() => vi.restoreAllMocks())

describe('mobile catalog refresh', () => {
  it('waits for a trailing refresh when a new conversation is created during an older request', async () => {
    let finish: (value: unknown) => void = () => undefined
    const request = vi.spyOn(wsClient, 'request').mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
      .mockResolvedValueOnce({ ...empty, teams: [{ id: 'new', name: '新团队', projectId: 'p' }] })
    const first = useConversationCatalog.getState().load()
    const next = useConversationCatalog.getState().load()
    finish(empty)
    await Promise.all([first, next])
    expect(request).toHaveBeenCalledTimes(2)
    expect(useConversationCatalog.getState().catalog.teams[0].id).toBe('new')
  })
  it('ignores results from the previous server and invalidates team caches on credentials change', async () => {
    let finish: (value: unknown) => void = () => undefined
    vi.spyOn(wsClient, 'request').mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const epoch = useConversationCatalog.getState().epoch
    const pending = useConversationCatalog.getState().load()
    useConnectionStore.setState({ serverUrl: 'http://example.invalid', token: 'test-only' })
    finish({ ...empty, teams: [{ id: 'old-server', name: '旧团队', projectId: 'p' }] })
    await pending
    expect(useConversationCatalog.getState().catalog).toEqual(empty)
    expect(useConversationCatalog.getState().epoch).toBe(epoch + 1)
    expect(useConversationCatalog.getState().loaded).toBe(false)
  })
})
