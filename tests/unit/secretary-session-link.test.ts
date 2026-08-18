import { beforeEach, describe, expect, test, vi } from 'vitest'
import { wsClient } from '../../ui/src/services/ws-client'
import { useSessionStore } from '../../ui/src/stores/session.store'
import {
  isSecretarySessionPurpose,
  secretaryWorkspacePath,
} from '../../ui/src/pages/secretary/secretary-session-link'

const linkedSession = {
  id: 'session-secretary-chat',
  agent_id: 'agent-1',
  task_id: null,
  acp_session_id: null,
  status: 'active',
  stage: '',
  started_at: '2026-08-17T00:00:00.000Z',
  closed_at: null,
  project_id: 'project-1',
  title: '项目秘书对话',
  purpose: 'secretary_chat' as const,
}

beforeEach(() => {
  vi.restoreAllMocks()
  useSessionStore.setState({
    sessions: [],
    currentSessionId: null,
    runningSessionIds: {},
    unreadSessionIds: {},
    staleSessionIds: {},
    stoppingSessionIds: {},
  })
})

describe('secretary Session links', () => {
  test('builds a project-scoped Workspace deep link with secretary ownership context', () => {
    expect(secretaryWorkspacePath('project one', 'secretary/1', 'session?1')).toBe(
      '/p/project%20one/workspace?sessionId=session%3F1&secretaryId=secretary%2F1',
    )
  })

  test('recognizes only the two hidden secretary Session purposes', () => {
    expect(isSecretarySessionPurpose('secretary_runtime')).toBe(true)
    expect(isSecretarySessionPurpose('secretary_chat')).toBe(true)
    expect(isSecretarySessionPurpose('conversation')).toBe(false)
    expect(isSecretarySessionPurpose(undefined)).toBe(false)
  })

  test('loads one guarded hidden Session into the Workspace state', async () => {
    const request = vi.spyOn(wsClient, 'request').mockResolvedValue(linkedSession)

    const result = await useSessionStore.getState().loadSecretarySession(
      'project-1',
      'secretary-1',
      linkedSession.id,
    )

    expect(request).toHaveBeenCalledWith({
      type: 'secretary.session.get',
      projectId: 'project-1',
      secretaryId: 'secretary-1',
      sessionId: linkedSession.id,
    })
    expect(result).toEqual(linkedSession)
    expect(useSessionStore.getState().sessions).toContainEqual(linkedSession)
    useSessionStore.setState({
      runningSessionIds: { [linkedSession.id]: true },
      unreadSessionIds: { [linkedSession.id]: true },
      staleSessionIds: { [linkedSession.id]: true },
      stoppingSessionIds: { [linkedSession.id]: true },
    })
    useSessionStore.getState().releaseSecretarySession(linkedSession.id)
    expect(useSessionStore.getState()).toMatchObject({
      sessions: [],
      runningSessionIds: {},
      unreadSessionIds: {},
      staleSessionIds: {},
      stoppingSessionIds: {},
    })
  })
})
