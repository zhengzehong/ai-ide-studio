import { afterEach, describe, expect, test } from 'vitest'
import { createFileChangeWorker, type FileChangeWorkerClient } from '../../src/core/file-change-worker-client.js'
import type { ToolCallData } from '../../src/types/ws-protocol.js'

let worker: FileChangeWorkerClient | undefined

afterEach(async () => {
  await worker?.close()
  worker = undefined
})

describe('file-change worker', () => {
  test('computes complete diff details outside the caller event loop', async () => {
    worker = await createFileChangeWorker()
    const lineCount = 10_000
    const oldLines = Array.from({ length: lineCount }, (_, index) => `old-${index}`)
    const newLines = [...oldLines]
    newLines[Math.floor(lineCount / 2)] = 'changed-line'
    const toolCall: ToolCallData = {
      id: 'tool-large',
      title: 'Edit file',
      status: 'completed',
      content: [{
        type: 'diff',
        path: 'src/large.ts',
        oldText: oldLines.join('\n'),
        newText: newLines.join('\n'),
      }],
    }

    const startedAt = performance.now()
    const pending = worker.calculate(toolCall)
    const callReturnedMs = performance.now() - startedAt

    expect(callReturnedMs).toBeLessThan(50)
    const result = await pending
    expect(result.changes.files[0]).toMatchObject({
      path: 'src/large.ts',
      addedLines: 1,
      deletedLines: 1,
    })
    expect(result.executionMs).toBeGreaterThan(0)
    expect(result.executionMs).toBeLessThan(2_000)
  }, 15_000)
})
