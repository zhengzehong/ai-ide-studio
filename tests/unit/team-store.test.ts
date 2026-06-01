import { beforeEach, describe, expect, test, vi } from 'vitest'
import { wsClient } from '../../ui/src/services/ws-client.ts'
import { useTeamStore, type TeamContextData } from '../../ui/src/stores/team.store.ts'

const emptyContext: TeamContextData = { team: null, currentMember: null, members: [], tasks: [], mailbox: [] }

beforeEach(() => {
  useTeamStore.setState({ current: emptyContext, loading: false })
  vi.restoreAllMocks()
})

describe('useTeamStore', () => {
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
