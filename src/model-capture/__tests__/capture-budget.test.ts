import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beginCapture, type CaptureRecord, type CaptureWriter, waitCaptureFlush } from '../capture-store.js'
import { createCaptureMemoryBudget } from '../capture-memory-budget.js'

vi.mock('../capture-memory-budget.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../capture-memory-budget.js')>()
  return { ...actual, captureMemoryBudget: actual.createCaptureMemoryBudget(32 * 1024, 48 * 1024) }
})
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, writeFile: vi.fn(actual.writeFile) }
})

let dir: string
const writers: CaptureWriter[] = []
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'capture-budget-')); vi.mocked(writeFile).mockClear() })
afterEach(async () => {
  await Promise.all(writers.splice(0).map((writer) => writer.finalize('completed')))
  await waitCaptureFlush()
  rmSync(dir, { recursive: true, force: true })
})

function create(request: unknown = { input: 'x'.repeat(8000) }): CaptureWriter {
  const writer = beginCapture(dir, { kind: 'messages', platform: { agentId: 'a', runtime: 'claude' }, requestHeaders: {}, request })
  writers.push(writer)
  return writer
}

function record(writer: CaptureWriter): CaptureRecord {
  return JSON.parse(readFileSync(writer.finalPath, 'utf8')) as CaptureRecord
}

describe('capture budget lifecycle', () => {
  test('rejects only excess reservations and releases once', () => {
    const budget = createCaptureMemoryBudget(100, 150)
    const a = budget.open(), b = budget.open()
    expect(a.retain(90)).toBeUndefined()
    expect(a.retain(11)).toBe('capture_limit')
    expect(b.retain(61)).toBe('total_limit')
    expect(b.retain(60)).toBeUndefined()
    a.release()
    a.release()
    expect(b.retain(40)).toBeUndefined()
    expect(budget.open().retain(51)).toBe('total_limit')
    b.release()
  })

  test('shares aggregate accounting across writers and holds it until the terminal write settles', async () => {
    const first = create(), second = create(), excess = create()
    await excess.finalize('completed')
    expect(record(excess)).toMatchObject({ truncated: true, truncationReason: 'total_limit', request: null })
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(writeFile).mockImplementationOnce(async (...args) => { await gate; return actual.writeFile(...args) })
    const finalizing = first.finalize('completed')
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(2))
    try {
      const stillFull = create()
      await stillFull.finalize('completed')
      expect(record(stillFull).truncationReason).toBe('total_limit')
    } finally { release?.(); await finalizing }
    const accepted = create()
    await accepted.finalize('completed')
    expect(record(accepted).truncated).toBeUndefined()
    await second.finalize('completed')
  })

  test('releases retained state on disk failure without rejecting model completion', async () => {
    const first = create(), second = create()
    vi.mocked(writeFile).mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(first.finalize('upstream_error')).resolves.toBeUndefined()
    const accepted = create()
    await accepted.finalize('completed')
    expect(record(accepted).request).toMatchObject({ input: expect.any(String) })
    expect(record(accepted).truncated).toBeUndefined()
    await second.finalize('completed')
  })

  test('truncates a non-streaming body while preserving its collected prefix', async () => {
    const writer = create(null)
    writer.appendTextChunk('prefix')
    writer.appendTextChunk('x'.repeat(20000))
    writer.appendTextChunk('tail')
    await writer.finalize('timeout')
    expect(record(writer)).toMatchObject({ truncated: true, truncationReason: 'capture_limit', terminalStatus: 'timeout', response: { text: 'prefix' } })
  })

  test('counts per-chunk overhead so tiny chunks cannot build an unlimited array', async () => {
    const writer = create(null)
    for (let i = 0; i < 2000; i += 1) writer.appendResponseChunk('x')
    await writer.finalize('completed')
    expect(record(writer).truncated).toBe(true)
    expect(record(writer).response.sse.length).toBeLessThan(512)
  })

  test('charges UTF-16 string storage rather than treating Unicode characters as one byte', async () => {
    const writer = create(null)
    writer.appendResponseChunk('\u4e2d'.repeat(8192))
    await writer.finalize('completed')
    expect(record(writer).response.sse).toEqual([])
    expect(record(writer).truncationReason).toBe('capture_limit')
  })
})
