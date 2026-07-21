import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useProjectStore } from '../../ui/src/stores/project.store'
import { useSessionStore, type SessionData } from '../../ui/src/stores/session.store'

const projectScopeMocks = vi.hoisted(() => ({
  invalidateProjectData: vi.fn(),
  refreshProjectData: vi.fn(async () => undefined),
}))

vi.mock('../../ui/src/project-scope/project-data-scope', () => projectScopeMocks)

const { recoverRealtimeGap } = await import('../../ui/src/app-runtime-bootstrap.ts')

function session(id: string, projectId: string): SessionData {
  return {
    id,
    agent_id: `agent-${id}`,
    task_id: null,
    acp_session_id: null,
    status: 'active',
    stage: 'idle',
    started_at: '2026-07-20T00:00:00.000Z',
    closed_at: null,
    project_id: projectId,
  }
}

describe('application realtime recovery', () => {
  beforeEach(() => {
    projectScopeMocks.invalidateProjectData.mockClear()
    projectScopeMocks.refreshProjectData.mockClear()
    useProjectStore.setState({ currentProjectId: 'project-a' })
    useSessionStore.setState({
      currentSessionId: 'session-a',
      sessions: [session('session-a', 'project-a')],
      sessionListCache: {
        entries: {
          'project-b': {
            data: [session('session-b', 'project-b')],
            fetchedAt: 1,
            lastAccessedAt: 1,
            invalidated: false,
            error: null,
          },
        },
        requestSeqByScope: {},
      },
    })
  })

  test('refreshes the owning project for an inactive session gap', async () => {
    const fetchMessages = vi.spyOn(useSessionStore.getState(), 'fetchMessages')
    const fetchEvents = vi.spyOn(useSessionStore.getState(), 'fetchEvents')
    const fetchRecovery = vi.spyOn(useSessionStore.getState(), 'fetchRecovery')

    await recoverRealtimeGap({ sessionId: 'session-b' })

    expect(projectScopeMocks.invalidateProjectData).toHaveBeenCalledWith('project-b')
    expect(projectScopeMocks.invalidateProjectData).not.toHaveBeenCalledWith('project-a')
    expect(projectScopeMocks.refreshProjectData).toHaveBeenCalledWith('project-b', { force: true })
    expect(fetchMessages).not.toHaveBeenCalled()
    expect(fetchEvents).not.toHaveBeenCalled()
    expect(fetchRecovery).not.toHaveBeenCalled()
  })

  test('restores active messages before starting the full project refresh', async () => {
    let resolveMessages: (() => void) | undefined
    let resolveRecovery: (() => void) | undefined
    const fetchMessages = vi.spyOn(useSessionStore.getState(), 'fetchMessages').mockImplementation(
      () => new Promise<void>((resolve) => { resolveMessages = resolve }),
    )
    const fetchRecovery = vi.spyOn(useSessionStore.getState(), 'fetchRecovery').mockImplementation(
      () => new Promise<void>((resolve) => { resolveRecovery = resolve }),
    )

    const recovering = recoverRealtimeGap({ sessionId: 'session-a' })
    await Promise.resolve()

    expect(fetchMessages).toHaveBeenCalledWith('session-a')
    expect(fetchRecovery).toHaveBeenCalledWith('session-a')
    expect(projectScopeMocks.refreshProjectData).not.toHaveBeenCalled()

    resolveMessages?.()
    resolveRecovery?.()
    await recovering

    expect(projectScopeMocks.refreshProjectData).toHaveBeenCalledWith('project-a', { force: true })
  })
})
