import { beforeEach, expect, test, vi } from 'vitest'
import { wsClient } from '@desktop/services/ws-client'
import { useAppStore } from '../../mobile/src/stores/app.store'
import { useSessionStore } from '../../mobile/src/stores/session.store'

beforeEach(() => {
  useAppStore.setState({
    projects: [],
    agents: [],
    currentProjectId: null,
    loading: false,
  })
  useSessionStore.setState({
    sessions: [],
    loading: false,
    filterAgent: null,
    filterStatus: null,
  })
})

test('session event refresh preserves the current project filter', async () => {
  useAppStore.getState().setCurrentProject('project-a')
  const request = vi.spyOn(wsClient, 'request').mockResolvedValue([])
  const handlers = new Map<string, (msg: Record<string, unknown>) => void>()
  const on = vi.spyOn(wsClient, 'on').mockImplementation((event, handler) => {
    handlers.set(event, handler)
    return () => handlers.delete(event)
  })

  const cleanup = useSessionStore.getState().setupListeners()
  handlers.get('session:changed')?.({ type: 'session:changed' })
  await vi.waitFor(() => {
    expect(request).toHaveBeenCalledWith({ type: 'widget.sessions.list', projectId: 'project-a' })
  })

  cleanup()
  request.mockRestore()
  on.mockRestore()
})
