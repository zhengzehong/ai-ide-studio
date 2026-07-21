import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBootstrapSnapshot } from '../../ui/src/project-scope/bootstrap-snapshot.ts'
import { createZustandBootstrapBridge } from '../../ui/src/project-scope/bootstrap-snapshot-stores.ts'
import { useAgentStore } from '../../ui/src/stores/agent.store.ts'
import { emptyProjectCache, type ProjectCacheState } from '../../ui/src/stores/project-cache.ts'
import { useProjectStore } from '../../ui/src/stores/project.store.ts'
import { useSessionStore } from '../../ui/src/stores/session.store.ts'
import { useTaskStore } from '../../ui/src/stores/task.store.ts'

describe('Zustand bootstrap snapshot bridge', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: [], currentProjectId: null, previousProjectId: null, loading: false, initialized: false,
    })
    useTaskStore.setState({
      tasks: [], activeScope: '__all__', taskCache: emptyProjectCache(), loading: false, refreshing: false,
    })
    useAgentStore.setState({
      agents: [], activeScope: '__all__', agentCache: emptyProjectCache(), loading: false, refreshing: false,
    })
    useSessionStore.setState({
      sessions: [], currentSessionId: null, messages: [], activeSessionScope: '__all__',
      sessionListCache: emptyProjectCache(), loading: false, refreshing: false,
    })
  })

  it('hydrates visible project lists and restores cached messages through existing selectSession', () => {
    const bridge = createZustandBootstrapBridge()
    const snapshot = buildBootstrapSnapshot({
      projects: [project('project-1')],
      currentProjectId: 'project-1',
      taskCache: cache('project-1', [{ id: 'task-1', title: 'Task' }]),
      agentCache: cache('project-1', [{ id: 'agent-1', name: 'Agent' }]),
      sessionListCache: cache('project-1', [{ id: 'session-1', agent_id: 'agent-1' }]),
      activeSession: {
        sessionId: 'session-1',
        messages: [
          { id: 'message-human', session_id: 'session-1', role: 'human', content: 'hello' },
          { id: 'message-running', session_id: 'session-1', role: 'agent', content: 'partial', status: 'running' },
        ],
      },
    }, 10_000)

    bridge.hydrate(snapshot)

    expect(useProjectStore.getState()).toMatchObject({
      currentProjectId: 'project-1', initialized: true, loading: false,
    })
    expect(useTaskStore.getState().tasks).toEqual([{ id: 'task-1', title: 'Task' }])
    expect(useAgentStore.getState().agents).toEqual([{ id: 'agent-1', name: 'Agent' }])
    expect(useSessionStore.getState().sessions).toEqual([{ id: 'session-1', agent_id: 'agent-1' }])
    expect(useSessionStore.getState().currentSessionId).toBeNull()

    useSessionStore.getState().selectSession('session-1')
    expect(useSessionStore.getState().messages).toEqual([
      { id: 'message-human', session_id: 'session-1', role: 'human', content: 'hello' },
    ])
  })

  it('exports only completed current-session messages and subscribes to all source stores', () => {
    const bridge = createZustandBootstrapBridge()
    useProjectStore.setState({ projects: [project('project-1')], currentProjectId: 'project-1' })
    useSessionStore.setState({
      currentSessionId: 'session-1',
      messages: [
        { id: 'message-done', session_id: 'session-1', role: 'agent', content: 'done', status: 'completed' },
        { id: 'message-running', session_id: 'session-1', role: 'agent', content: 'partial', status: 'running' },
      ],
    })

    const source = bridge.read()
    expect(source.activeSession).toEqual({
      sessionId: 'session-1',
      messages: [{ id: 'message-done', session_id: 'session-1', role: 'agent', content: 'done', status: 'completed' }],
    })

    const listener = vi.fn()
    const unsubscribe = bridge.subscribe(listener)
    useTaskStore.setState({ refreshing: true })
    useAgentStore.setState({ refreshing: true })
    useSessionStore.setState({ refreshing: true })
    useProjectStore.setState({ loading: true })
    expect(listener).toHaveBeenCalledTimes(4)
    unsubscribe()
    useTaskStore.setState({ refreshing: false })
    expect(listener).toHaveBeenCalledTimes(4)
  })
})

function cache(scope: string, data: unknown[]): ProjectCacheState<unknown[]> {
  return {
    entries: {
      [scope]: {
        data,
        fetchedAt: 1,
        lastAccessedAt: 1,
        invalidated: false,
        error: null,
      },
    },
    requestSeqByScope: {},
  }
}

function project(id: string) {
  return {
    id,
    name: id,
    work_dir: `C:/${id}`,
    description: null,
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-20T00:00:00.000Z',
    color: null,
    icon: null,
    last_visited_at: null,
    visit_count: 0,
  }
}
