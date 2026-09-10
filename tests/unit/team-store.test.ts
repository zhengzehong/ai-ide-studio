import { beforeEach, describe, expect, test, vi } from 'vitest'
import { wsClient } from '../../ui/src/services/ws-client.ts'
import { useTeamStore, type TeamContextData } from '../../ui/src/stores/team.store.ts'
import { emptyProjectCache } from '../../ui/src/stores/project-cache.ts'

const emptyContext: TeamContextData = { team: null, currentMember: null, members: [], tasks: [], mailbox: [] }

beforeEach(() => {
  useTeamStore.setState({ current: emptyContext, loading: false, teams: [], teamsLoading: false, teamCache: emptyProjectCache(), activeProjectId: null })
  vi.restoreAllMocks()
})

describe('useTeamStore', () => {
  test('a forced post-mutation refresh wins over an older response', async () => {
    let resolveOld!: (value: unknown) => void
    const request = vi.spyOn(wsClient, 'request').mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve })).mockResolvedValueOnce([])
    const old = useTeamStore.getState().fetchTeams('p')
    await useTeamStore.getState().fetchTeams('p', true)
    resolveOld([teamContext('deleted', 'Deleted').team])
    await old
    expect(request).toHaveBeenCalledTimes(2)
    expect(useTeamStore.getState().teams).toEqual([])
  })

  test('leaving the project prevents a pending load from restoring its list', async () => {
    let resolve!: (value: unknown) => void
    vi.spyOn(wsClient, 'request').mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const pending = useTeamStore.getState().fetchTeams('p')
    await useTeamStore.getState().fetchTeams(null)
    resolve([teamContext('t', 'Team').team])
    await pending
    expect(useTeamStore.getState().teams).toEqual([])
    expect(useTeamStore.getState().teamsLoading).toBe(false)
  })
  test('restores cached lists immediately and retains them on refresh failure', async () => {
    const team = teamContext('t', 'Cached').team!
    vi.spyOn(wsClient, 'request').mockResolvedValueOnce([team]).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('offline'))
    await useTeamStore.getState().fetchTeams('p')
    await useTeamStore.getState().fetchTeams('other')
    const refresh = useTeamStore.getState().fetchTeams('p')
    expect(useTeamStore.getState().teams).toEqual([team])
    expect(useTeamStore.getState().teamsLoading).toBe(false)
    await refresh
    expect(useTeamStore.getState().teams).toEqual([team])
  })

  test('deduplicates overlapping loads and rejects cross-project late responses', async () => {
    let resolveOld!: (value: unknown) => void
    const request = vi.spyOn(wsClient, 'request').mockImplementation(msg => msg.projectId === 'old'
      ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve([]))
    const old = useTeamStore.getState().fetchTeams('old')
    const duplicate = useTeamStore.getState().fetchTeams('old')
    await useTeamStore.getState().fetchTeams('new')
    resolveOld([teamContext('old', 'Old').team])
    await Promise.all([old, duplicate])
    expect(request).toHaveBeenCalledTimes(2)
    expect(useTeamStore.getState().teams).toEqual([])
    expect(useTeamStore.getState().activeProjectId).toBe('new')
  })
  test('ignores stale teams.current responses after switching sessions', async () => {
    const requests: Array<Record<string, unknown>> = []
    vi.spyOn(wsClient, 'request').mockImplementation(async (msg: Record<string, unknown>) => {
      requests.push(msg)
      if (msg.sessionId === 'sess-old') {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return teamContext('team-old', 'Old Team')
      }
      return emptyContext
    })

    const oldRequest = useTeamStore.getState().fetchCurrent('sess-old')
    const newRequest = useTeamStore.getState().fetchCurrent('sess-new')
    await Promise.all([oldRequest, newRequest])

    expect(requests.map((item) => item.sessionId)).toEqual(['sess-old', 'sess-new'])
    expect(useTeamStore.getState().current.team).toBeNull()
    expect(useTeamStore.getState().loading).toBe(false)
  })
})

function teamContext(id: string, name: string): TeamContextData {
  return {
    team: {
      id,
      project_id: 'proj-1',
      name,
      description: null,
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      archived_at: null,
    },
    currentMember: null,
    members: [],
    tasks: [],
    mailbox: [],
  }
}
