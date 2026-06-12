import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useAppStore } from '../../mobile/src/stores/app.store'
import { useSessionStore } from '../../mobile/src/stores/session.store'
import { bootstrapMobileData } from '../../mobile/src/App'

describe('mobile app bootstrap', () => {
  beforeEach(() => {
    useAppStore.setState({ currentProjectId: 'project-a' } as unknown as Parameters<typeof useAppStore.setState>[0])
    useSessionStore.setState({ sessions: [] } as unknown as Parameters<typeof useSessionStore.setState>[0])
    vi.restoreAllMocks()
  })

  test('loads projects and agents before fetching mapped sessions', async () => {
    const order: string[] = []
    vi.spyOn(useAppStore.getState(), 'fetchProjects').mockImplementation(async () => {
      order.push('projects:start')
      await Promise.resolve()
      order.push('projects:done')
    })
    vi.spyOn(useAppStore.getState(), 'fetchAgents').mockImplementation(async () => {
      order.push('agents:start')
      await Promise.resolve()
      order.push('agents:done')
    })
    vi.spyOn(useSessionStore.getState(), 'fetchSessions').mockImplementation(async (projectId?: string | null) => {
      order.push(`sessions:${projectId ?? 'all'}`)
    })

    await bootstrapMobileData()

    expect(order).toEqual([
      'projects:start',
      'agents:start',
      'projects:done',
      'agents:done',
      'sessions:project-a',
    ])
  })
})
