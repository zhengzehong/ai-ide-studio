import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { events } from '../../src/core/events.js'
import { sessionManager } from '../../src/core/sessions.js'
import { cancelPendingForSessions, dispatchMemberPrompt } from '../../src/core/team-member-dispatcher.js'

vi.mock('../../src/core/sessions.js', () => ({
  sessionManager: { enqueuePrompt: vi.fn(), isPromptActive: vi.fn() },
}))
vi.mock('../../src/store/tasks.js', () => ({ taskStore: { get: vi.fn() } }))
vi.mock('../../src/store/teams.js', () => ({ teamMemberStore: { list: () => [] } }))
vi.mock('../../src/core/team-wake-coordinator.js', () => ({
  teamWakeCoordinator: { notifyDispatchFailed: vi.fn() },
}))

const busy = new Set<string>()
let sessions: string[]
let testIndex = 0
const pendingResolvers: Array<() => void> = []
const enqueue = vi.mocked(sessionManager.enqueuePrompt)

beforeEach(() => {
  sessions = [`member-a-${++testIndex}`, `member-b-${testIndex}`]
  busy.clear()
  vi.mocked(sessionManager.isPromptActive).mockImplementation((sessionId) => busy.has(sessionId))
  enqueue.mockResolvedValue()
})

afterEach(async () => {
  cancelPendingForSessions(sessions)
  for (const resolve of pendingResolvers.splice(0)) resolve()
  await Promise.resolve()
  await Promise.resolve()
  vi.resetAllMocks()
})

function dispatch(prompt: string, sessionId = sessions[0]): string {
  return dispatchMemberPrompt({ teamId: 'team', memberId: sessionId, sessionId, prompt })
}

function idle(sessionId = sessions[0]): void {
  busy.delete(sessionId)
  events.emit('session:activity', {
    sessionId, agentId: 'agent', state: 'idle', reason: 'prompt-done', timestamp: new Date().toISOString(),
  })
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  pendingResolvers.push(resolve)
  return { promise, resolve, reject }
}

describe('team member dispatch cleanup ordering', () => {
  test('resumes after done -> cleanup -> idle, preserving the queued order', async () => {
    busy.add(sessions[0])
    expect(dispatch('first')).toBe('queued')
    expect(dispatch('second')).toBe('queued')
    events.emit('session:done', { sessionId: sessions[0] })
    expect(enqueue).not.toHaveBeenCalled()

    idle()
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2))
    expect(enqueue.mock.calls.map((call) => call[1])).toEqual(['first', 'second'])
  })

  test('keeps the in-flight reservation until settlement despite repeated done/idle events', async () => {
    const first = deferred()
    const second = deferred()
    enqueue.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    expect(dispatch('first')).toBe('accepted')
    expect(dispatch('second')).toBe('queued')
    events.emit('session:done', { sessionId: sessions[0] })
    idle()
    idle()
    expect(dispatch('third')).toBe('queued')
    expect(enqueue).toHaveBeenCalledTimes(1)

    first.resolve()
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2))
    idle()
    expect(enqueue).toHaveBeenCalledTimes(2)
    second.resolve()
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(3))
    expect(enqueue.mock.calls.map((call) => call[1])).toEqual(['first', 'second', 'third'])
  })

  test('does not let new work jump the older queue when the session becomes idle', async () => {
    busy.add(sessions[0])
    dispatch('older')
    busy.delete(sessions[0])
    expect(dispatch('newer')).toBe('queued')
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2))
    expect(enqueue.mock.calls.map((call) => call[1])).toEqual(['older', 'newer'])
  })

  test('continues on promise settlement without requiring a runtime done event', async () => {
    const first = deferred()
    enqueue.mockReturnValueOnce(first.promise)
    dispatch('first')
    dispatch('second')
    first.resolve()
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2))
  })

  test('waits for idle if the session is still busy at promise settlement', async () => {
    const first = deferred()
    enqueue.mockReturnValueOnce(first.promise)
    dispatch('first')
    busy.add(sessions[0])
    dispatch('second')
    first.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(enqueue).toHaveBeenCalledTimes(1)
    idle()
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2))
  })

  test('a rejected dispatch releases its reservation and continues the queue', async () => {
    const first = deferred()
    enqueue.mockReturnValueOnce(first.promise)
    dispatch('first')
    dispatch('second')
    first.reject(new Error('会话不存在'))
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2))
    expect(enqueue.mock.calls[1][1]).toBe('second')
  })

  test('cancels pending work while in flight without blocking another member', async () => {
    const first = deferred()
    enqueue.mockReturnValueOnce(first.promise)
    dispatch('first')
    dispatch('cancelled')
    cancelPendingForSessions([sessions[0]])
    expect(dispatch('independent', sessions[1])).toBe('accepted')
    first.resolve()
    idle()
    await Promise.resolve()
    await Promise.resolve()
    expect(enqueue.mock.calls.map((call) => call[1])).toEqual(['first', 'independent'])
  })

  test('drains the queue when an autonomous turn settles (autonomous-done idle)', async () => {
    busy.add(sessions[0])
    expect(dispatch('queued behind autonomy')).toBe('queued')

    busy.delete(sessions[0])
    events.emit('session:activity', {
      sessionId: sessions[0],
      agentId: 'agent',
      state: 'idle',
      reason: 'autonomous-done',
      timestamp: new Date().toISOString(),
    })

    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1))
    expect(enqueue.mock.calls[0]?.[1]).toBe('queued behind autonomy')
  })
})
