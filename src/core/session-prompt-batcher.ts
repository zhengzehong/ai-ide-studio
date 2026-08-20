export interface PromptBatchEntry<T> {
  batchKey: string
  dedupeKey?: string
  value: T
}

interface Deferred {
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

interface PendingEntry<T> extends PromptBatchEntry<T> {
  completion: Deferred
}

interface PromptBatchState<T> {
  pending: PendingEntry<T>[]
  pendingByDedupeKey: Map<string, PendingEntry<T>>
  activeByDedupeKey: Map<string, Promise<void>>
  flushing: boolean
}

export class SessionPromptBatcher<T> {
  private readonly states = new Map<string, PromptBatchState<T>>()

  enqueue(sessionId: string, entry: PromptBatchEntry<T>): Promise<void> {
    const state = this.getState(sessionId)
    if (entry.dedupeKey) {
      const active = state.activeByDedupeKey.get(entry.dedupeKey)
      if (active) return active

      const pending = state.pendingByDedupeKey.get(entry.dedupeKey)
      if (pending) {
        pending.value = entry.value
        pending.batchKey = entry.batchKey
        return pending.completion.promise
      }
    }

    const completion = createDeferred()
    const pending: PendingEntry<T> = { ...entry, completion }
    state.pending.push(pending)
    if (entry.dedupeKey) state.pendingByDedupeKey.set(entry.dedupeKey, pending)
    return completion.promise
  }

  hasPending(sessionId: string): boolean {
    const state = this.states.get(sessionId)
    return !!state && (state.flushing || state.pending.length > 0)
  }

  async flush(sessionId: string, runBatch: (entries: T[]) => Promise<void>): Promise<void> {
    const state = this.states.get(sessionId)
    if (!state || state.flushing) return

    state.flushing = true
    try {
      while (state.pending.length > 0) {
        const batch = takeNextBatch(state)
        const activeCompletion = Promise.all(batch.map((entry) => entry.completion.promise)).then(() => undefined)
        void activeCompletion.catch(() => undefined)
        for (const entry of batch) {
          if (entry.dedupeKey) state.activeByDedupeKey.set(entry.dedupeKey, activeCompletion)
        }
        try {
          await runBatch(batch.map((entry) => entry.value))
          for (const entry of batch) entry.completion.resolve()
        } catch (error) {
          for (const entry of batch) entry.completion.reject(error)
        } finally {
          for (const entry of batch) {
            if (entry.dedupeKey && state.activeByDedupeKey.get(entry.dedupeKey) === activeCompletion) {
              state.activeByDedupeKey.delete(entry.dedupeKey)
            }
          }
        }
      }
    } finally {
      state.flushing = false
      if (state.pending.length === 0 && state.activeByDedupeKey.size === 0) this.states.delete(sessionId)
    }
  }

  private getState(sessionId: string): PromptBatchState<T> {
    const existing = this.states.get(sessionId)
    if (existing) return existing
    const state: PromptBatchState<T> = {
      pending: [],
      pendingByDedupeKey: new Map(),
      activeByDedupeKey: new Map(),
      flushing: false,
    }
    this.states.set(sessionId, state)
    return state
  }
}

function takeNextBatch<T>(state: PromptBatchState<T>): PendingEntry<T>[] {
  const first = state.pending.shift()
  if (!first) return []
  if (first.dedupeKey) state.pendingByDedupeKey.delete(first.dedupeKey)

  const batch = [first]
  const remaining: PendingEntry<T>[] = []
  for (const next of state.pending) {
    if (next.batchKey !== first.batchKey) {
      remaining.push(next)
      continue
    }
    if (next.dedupeKey) state.pendingByDedupeKey.delete(next.dedupeKey)
    batch.push(next)
  }
  state.pending = remaining
  return batch
}

function createDeferred(): Deferred {
  let resolvePromise!: () => void
  let rejectPromise!: (error: unknown) => void
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}
