import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useAdvisorStore, type AdvisorSuggestion, type AdvisorSuggestionView } from '../../ui/src/stores/advisor.store.js'
import { wsClient } from '../../ui/src/services/ws-client.js'

vi.mock('../../ui/src/services/ws-client.js', () => ({
  wsClient: { request: vi.fn(), on: vi.fn(() => () => {}) },
}))
const start = Date.parse('2026-09-08T00:00:00.000Z')
function row(id = 'one', project = 'p1'): AdvisorSuggestion {
  return {
    id, project_id: project, round_id: 'round', trigger_session_id: null, sort_order: 0, type: 'action',
    title: '建议', description_markdown: '说明', artifact_json: null, source_evidence_json: '[]',
    suggested_agent_id: null, agent_reason: '', status: 'pending', dispatch_token: null, task_id: null,
    execution_session_id: null, created_at: new Date(start - 86_399_000).toISOString(),
    updated_at: new Date(start).toISOString(), expire_at: new Date(start + 1000).toISOString(),
  }
}
function view(rows: AdvisorSuggestion[] = [row()]): AdvisorSuggestionView {
  return { suggestions: rows, settled: [], expired: [], pendingCount: rows.length, serverNow: new Date(start).toISOString() }
}
function reply(rows: AdvisorSuggestion[] = [row()]): { config: null; suggestions: AdvisorSuggestionView } {
  return { config: null, suggestions: view(rows) }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(start)
  vi.mocked(wsClient.request).mockReset()
  useAdvisorStore.setState({ projectId: null, view: null, config: null, loading: false, ignoring: false, actionError: null, clockOffsetMs: 0 })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

test('a long-open list hides at the exact deadline and clears the badge without new events', async () => {
  vi.mocked(wsClient.request).mockResolvedValue(reply())
  const stop = useAdvisorStore.getState().setupListeners()
  try {
    await useAdvisorStore.getState().load('p1')
    expect(useAdvisorStore.getState().view?.suggestions).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(useAdvisorStore.getState().view).toMatchObject({ suggestions: [], pendingCount: 0 })
  } finally { stop() }
  expect(vi.getTimerCount()).toBe(0)
})

test('server clock corrects a client that is an hour ahead', async () => {
  vi.setSystemTime(start + 3_600_000)
  vi.mocked(wsClient.request).mockResolvedValue(reply())
  const stop = useAdvisorStore.getState().setupListeners()
  try {
    await useAdvisorStore.getState().load('p1')
    expect(useAdvisorStore.getState().view?.suggestions).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(useAdvisorStore.getState().view?.suggestions).toHaveLength(0)
  } finally { stop() }
})

test('bulk ignore sends a snapshot and failure leaves suggestions available for retry', async () => {
  vi.mocked(wsClient.request).mockResolvedValueOnce(reply())
  await useAdvisorStore.getState().load('p1')
  vi.mocked(wsClient.request).mockRejectedValueOnce(new Error('网络失败'))
  await expect(useAdvisorStore.getState().ignoreAll()).rejects.toThrow('网络失败')
  expect(wsClient.request).toHaveBeenLastCalledWith({ type: 'advisor.suggestion.ignoreAll', projectId: 'p1', ids: ['one'] })
  expect(useAdvisorStore.getState()).toMatchObject({ ignoring: false, actionError: '网络失败' })
  expect(useAdvisorStore.getState().view?.suggestions).toHaveLength(1)
})

test('late ignore responses do not overwrite a different project', async () => {
  vi.mocked(wsClient.request).mockResolvedValueOnce(reply())
  await useAdvisorStore.getState().load('p1')
  let finish!: (value: unknown) => void
  vi.mocked(wsClient.request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const ignore = useAdvisorStore.getState().ignore('one')
  vi.mocked(wsClient.request).mockResolvedValueOnce(reply([row('two', 'p2')]))
  await useAdvisorStore.getState().load('p2')
  finish({ suggestions: view([]) })
  await ignore
  expect(useAdvisorStore.getState().projectId).toBe('p2')
  expect(useAdvisorStore.getState().view?.suggestions[0]?.id).toBe('two')
})

test('an older read cannot resurrect an ignored suggestion', async () => {
  vi.mocked(wsClient.request).mockResolvedValueOnce(reply())
  await useAdvisorStore.getState().load('p1')
  let finish!: (value: unknown) => void
  vi.mocked(wsClient.request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const oldRead = useAdvisorStore.getState().load('p1', true)
  vi.mocked(wsClient.request).mockResolvedValueOnce({ suggestions: view([]) }).mockResolvedValueOnce(reply([]))
  await useAdvisorStore.getState().ignore('one')
  finish(reply())
  await oldRead
  expect(useAdvisorStore.getState().view?.suggestions).toHaveLength(0)
})

test('bulk success leaves newly arrived suggestions and excludes dispatching rows from its snapshot', async () => {
  const busy = { ...row('busy'), dispatch_token: 'running' }
  vi.mocked(wsClient.request).mockResolvedValueOnce(reply([row(), busy]))
  await useAdvisorStore.getState().load('p1')
  vi.mocked(wsClient.request)
    .mockResolvedValueOnce({ ignoredCount: 1, suggestions: view([busy, row('new')]) })
    .mockResolvedValueOnce(reply([busy, row('new')]))
  expect(await useAdvisorStore.getState().ignoreAll()).toBe(1)
  expect(wsClient.request).toHaveBeenNthCalledWith(2, { type: 'advisor.suggestion.ignoreAll', projectId: 'p1', ids: ['one'] })
  expect(useAdvisorStore.getState().view?.suggestions.map(item => item.id)).toEqual(['busy', 'new'])
})

test('empty bulk ignore does not send a request', async () => {
  useAdvisorStore.setState({ projectId: 'p1', view: view([]) })
  expect(await useAdvisorStore.getState().ignoreAll()).toBe(0)
  expect(wsClient.request).not.toHaveBeenCalled()
})
