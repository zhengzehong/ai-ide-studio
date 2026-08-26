import { Hono } from 'hono'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getOrCreateRetentionControlToken, readRetentionControlToken } from '../../src/data-retention/control-token.js'
import { DataRetentionService } from '../../src/data-retention/retention-service.js'
import { mountRetentionRoutes } from '../../src/gateway/http/retention-routes.js'
import type { WriteDataPort } from '../../src/ports/write-data-port.js'

let temporaryDirectory: string | undefined

afterEach(() => {
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
  temporaryDirectory = undefined
})

describe('retention control', () => {
  it('persists a stable local control token outside the database', () => {
    temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'retention-token-'))
    const first = getOrCreateRetentionControlToken(temporaryDirectory)
    const second = getOrCreateRetentionControlToken(temporaryDirectory)

    expect(first).toHaveLength(64)
    expect(second).toBe(first)
    expect(readRetentionControlToken(temporaryDirectory)).toBe(first)
  })

  it('requires the control token and keeps dry-run read-only', async () => {
    const writer = fakeWritePort()
    const service = new DataRetentionService({ writeDataPort: writer, mode: 'off' })
    const app = new Hono()
    mountRetentionRoutes(app, service, 'retention-secret')

    expect((await app.request('/api/v1/retention/status')).status).toBe(403)
    const response = await app.request('/api/v1/retention/dry-run', {
      method: 'POST',
      headers: { 'x-ai-ide-retention-token': 'retention-secret' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      result: { eligibleMessages: 2, processRows: 3, eventRows: 4 },
      status: { state: 'idle' },
    })
    expect(writer.runRetentionBatch).not.toHaveBeenCalled()
  })

  it('requires explicit confirmation before starting delete mode', async () => {
    const service = new DataRetentionService({ writeDataPort: fakeWritePort(), mode: 'off' })
    const app = new Hono()
    mountRetentionRoutes(app, service, 'retention-secret')
    const headers = {
      'content-type': 'application/json',
      'x-ai-ide-retention-token': 'retention-secret',
    }

    expect(
      (
        await app.request('/api/v1/retention/delete', {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await app.request('/api/v1/retention/delete', {
          method: 'POST',
          headers,
          body: JSON.stringify({ confirm: true }),
        })
      ).status,
    ).toBe(202)
    await service.close()
  })
})

function fakeWritePort(): WriteDataPort {
  return {
    commitBatch: vi.fn(async () => {
      throw new Error('not used')
    }),
    sessionCursor: vi.fn(async () => ({ sequence: 0 })),
    enqueueRuntimeCommand: vi.fn(async () => {
      throw new Error('not used')
    }),
    listRecoverableRuntimeCommands: vi.fn(async () => []),
    updateRuntimeCommand: vi.fn(async () => {
      throw new Error('not used')
    }),
    maintain: vi.fn(async () => ({
      walBytesBefore: 0,
      walBytesAfter: 0,
      checkpointAttempted: false,
      checkpointMode: 'none',
      checkpointBusyPages: 0,
      checkpointLogPages: 0,
      checkpointedPages: 0,
      optimized: false,
      deletedPublishedOutboxRows: 0,
      elapsedMs: 0,
    })),
    inspectRetention: vi.fn(async () => ({
      eligibleMessages: 2,
      processRows: 3,
      eventRows: 4,
      estimatedBytes: 5,
    })),
    runRetentionBatch: vi.fn(async () => ({
      messageId: null,
      resetProcessItemCount: false,
      deletedProcessRows: 0,
      deletedEventRows: 0,
      hasMore: false,
      elapsedMs: 0,
    })),
    drain: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }
}
