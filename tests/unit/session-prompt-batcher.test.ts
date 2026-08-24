import { describe, expect, test } from 'vitest'
import { SessionPromptBatcher } from '../../src/core/session-prompt-batcher.js'

describe('SessionPromptBatcher', () => {
  test('groups interleaved entries for the same project context into one turn', async () => {
    const batcher = new SessionPromptBatcher<string>()
    const seen: string[][] = []

    const first = batcher.enqueue('session-1', { batchKey: 'project-a', value: 'a-1' })
    const middle = batcher.enqueue('session-1', { batchKey: 'project-b', value: 'b-1' })
    const last = batcher.enqueue('session-1', { batchKey: 'project-a', value: 'a-2' })

    await batcher.flush('session-1', async (entries) => {
      seen.push(entries)
    })
    await Promise.all([first, middle, last])

    expect(seen).toEqual([['a-1', 'a-2'], ['b-1']])
  })

  test('freezes a batch before entries that arrive during its turn', async () => {
    const batcher = new SessionPromptBatcher<string>()
    const gate = deferred<void>()
    const seen: string[][] = []
    const first = batcher.enqueue('session-1', { batchKey: 'project-a', value: 'first' })
    const flushing = batcher.flush('session-1', async (entries) => {
      seen.push(entries)
      if (entries[0] === 'first') await gate.promise
    })

    await waitUntil(() => seen.length === 1)
    const second = batcher.enqueue('session-1', { batchKey: 'project-a', value: 'second' })
    gate.resolve()

    await flushing
    await Promise.all([first, second])
    expect(seen).toEqual([['first'], ['second']])
  })

  test('keeps only the newest pending entry for a stable dedupe key', async () => {
    const batcher = new SessionPromptBatcher<string>()
    const seen: string[][] = []
    const first = batcher.enqueue('session-1', { batchKey: 'project-a', dedupeKey: 'rule:daily', value: 'old' })
    const latest = batcher.enqueue('session-1', { batchKey: 'project-a', dedupeKey: 'rule:daily', value: 'new' })

    await batcher.flush('session-1', async (entries) => {
      seen.push(entries)
    })
    await Promise.all([first, latest])

    expect(seen).toEqual([['new']])
  })

  test('rejects a failed batch but continues with later queued input', async () => {
    const batcher = new SessionPromptBatcher<string>()
    const gate = deferred<void>()
    const seen: string[][] = []
    const first = batcher.enqueue('session-1', { batchKey: 'project-a', value: 'failed' })
    const firstResult = first.catch((error: unknown) => error)
    const flushing = batcher.flush('session-1', async (entries) => {
      seen.push(entries)
      if (entries[0] === 'failed') {
        await gate.promise
        throw new Error('first batch failed')
      }
    })

    await waitUntil(() => seen.length === 1)
    const second = batcher.enqueue('session-1', { batchKey: 'project-a', value: 'next' })
    gate.resolve()

    await flushing
    await expect(firstResult).resolves.toBeInstanceOf(Error)
    await expect(second).resolves.toBeUndefined()
    expect(seen).toEqual([['failed'], ['next']])
  })

  test('filters stale entries before running a batch', async () => {
    const seen: string[][] = []
    const batcher = new SessionPromptBatcher<string>(async (_sessionId, entries) =>
      entries.filter((entry) => entry !== 'stale'))
    const stale = batcher.enqueue('session-1', { batchKey: 'project-a', value: 'stale' })
    const current = batcher.enqueue('session-1', { batchKey: 'project-a', value: 'current' })

    await batcher.flush('session-1', async (entries) => {
      seen.push(entries)
    })

    await Promise.all([stale, current])
    expect(seen).toEqual([['current']])
  })
})

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for batch')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
