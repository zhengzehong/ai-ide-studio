import type { SessionDoneData } from '../types/ws-protocol.js'
import { createChildLogger } from './logger.js'

export const ADVISOR_BATCH_MS = 15 * 60 * 1000
const log = createChildLogger('advisor-batch')
interface BatchState {
  events: Map<string, SessionDoneData>
  timer: ReturnType<typeof setTimeout> | null
  busy: boolean
  generation: number
}
interface AdvisorBatchScheduler {
  add: (projectId: string, event: SessionDoneData) => void
  reset: (projectId: string) => void
  dispose: () => void
}

export function createAdvisorBatchScheduler(
  run: (projectId: string, events: SessionDoneData[], isCurrent: () => boolean) => Promise<void>,
): AdvisorBatchScheduler {
  const states = new Map<string, BatchState>()

  function schedule(projectId: string, state: BatchState): void {
    if (state.timer || state.busy || !state.events.size) return
    state.timer = setTimeout(() => { void flush(projectId, state) }, ADVISOR_BATCH_MS)
    state.timer.unref?.()
  }

  async function flush(projectId: string, state: BatchState): Promise<void> {
    state.timer = null
    if (state.busy || !state.events.size) return
    const batch = [...state.events.values()]
    state.events.clear()
    state.busy = true
    const generation = state.generation
    try {
      await run(projectId, batch, () => states.get(projectId) === state && state.generation === generation)
    } catch (err) {
      log.error({ err, projectId, sessionCount: batch.length }, '参谋聚合分析失败，等待后续变化')
    } finally {
      state.busy = false
      if (states.get(projectId) === state) {
        if (state.events.size) schedule(projectId, state)
        else states.delete(projectId)
      }
    }
  }

  return {
    add(projectId, event): void {
      let state = states.get(projectId)
      if (!state) {
        state = { events: new Map(), timer: null, busy: false, generation: 0 }
        states.set(projectId, state)
      }
      state.events.delete(event.sessionId)
      state.events.set(event.sessionId, event)
      log.debug({ projectId, sessionId: event.sessionId, pending: state.events.size }, '参谋变化已合并')
      schedule(projectId, state)
    },
    reset(projectId): void {
      const state = states.get(projectId)
      if (!state) return
      if (state.timer) clearTimeout(state.timer)
      state.timer = null
      state.events.clear()
      state.generation += 1
      if (!state.busy) states.delete(projectId)
    },
    dispose(): void {
      for (const state of states.values()) if (state.timer) clearTimeout(state.timer)
      states.clear()
    },
  }
}
