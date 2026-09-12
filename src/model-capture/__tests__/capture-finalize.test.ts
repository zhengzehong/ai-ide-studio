import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beginCapture, type CaptureRecord, type CaptureWriter, waitCaptureFlush } from '../capture-store.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, writeFile: vi.fn(actual.writeFile) }
})

let tmp: string
const writers: CaptureWriter[] = []
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'capture-finalize-')); vi.mocked(writeFile).mockClear() })
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(writers.splice(0).map((writer) => writer.finalize('completed')))
  await waitCaptureFlush()
  rmSync(tmp, { recursive: true, force: true })
})

function create(request: unknown = {}): CaptureWriter {
  const writer = beginCapture(tmp, { kind: 'messages', platform: { agentId: 'test', runtime: 'claude' }, requestHeaders: {}, request })
  writers.push(writer)
  return writer
}

function record(writer: CaptureWriter): CaptureRecord {
  return JSON.parse(readFileSync(writer.finalPath, 'utf8')) as CaptureRecord
}

describe('capture writes once at finalization', () => {
  test('does not snapshot at two seconds or after crossing 64 KiB', async () => {
    vi.useFakeTimers()
    const writer = create({ context: 'x'.repeat(512 * 1024) })
    writer.appendResponseChunk('data: small\n\n')
    await vi.advanceTimersByTimeAsync(2100)
    expect(writeFile).not.toHaveBeenCalled()
    writer.appendResponseChunk('x'.repeat(70 * 1024))
    for (let i = 0; i < 300; i += 1) writer.appendResponseChunk('data: delta\n\n')
    await vi.advanceTimersByTimeAsync(2100)
    expect(writeFile).not.toHaveBeenCalled()
    expect(existsSync(writer.tmpPath)).toBe(false)
    vi.useRealTimers()
    await writer.finalize('completed')
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(record(writer).response.sse).toHaveLength(302)
  })

  test.each(['completed', 'client_aborted', 'timeout', 'upstream_error'] as const)('writes a stable terminal record for %s', async (terminal) => {
    const writer = create()
    writer.appendResponseChunk('data: {"type":"content_block_delta","delta":{"text":"OK"}}\n\n')
    writer.setStatus(200)
    const first = writer.finalize(terminal)
    writer.appendResponseChunk('late')
    writer.appendTextChunk('late')
    writer.setError('late error')
    writer.setStatus(500)
    const second = writer.finalize('proxy_restart')
    expect(second).toBe(first)
    await first
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(record(writer)).toMatchObject({ terminalStatus: terminal, status: 200, response: { text: 'OK' } })
    expect(record(writer).error).toBeUndefined()
  })

  test('bounds a single response and preserves its prefix', async () => {
    const writer = create()
    writer.appendResponseChunk('data: prefix\n\n')
    const block = 'x'.repeat(1024 * 1024)
    for (let i = 0; i < 40; i += 1) writer.appendResponseChunk(block)
    writer.appendResponseChunk('late tail')
    await writer.finalize('completed')
    const saved = record(writer)
    expect(saved).toMatchObject({ truncated: true, truncationReason: 'capture_limit' })
    expect(saved.response.sse[0]).toBe('data: prefix\n\n')
    expect(saved.response.sse).not.toContain('late tail')
    expect(saved.response.sse.join('').length).toBeLessThan(16 * 1024 * 1024)
  })

  test('does not retain an oversized request', async () => {
    const writer = create({ input: 'x'.repeat(17 * 1024 * 1024) })
    writer.appendResponseChunk('not collected')
    await writer.finalize('completed')
    expect(record(writer)).toMatchObject({ request: null, truncated: true, truncationReason: 'capture_limit', response: { sse: [] } })
  })
})
