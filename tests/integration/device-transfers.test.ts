import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { deviceStore } from '../../src/store/devices.js'
import { hashDeviceSecret } from '../../src/devices/auth.js'
import { DeviceJobService } from '../../src/devices/job-service.js'
import { DeviceTransferService } from '../../src/devices/transfer-service.js'
import type { DeviceJobRequest } from '../../src/devices/protocol.js'
import type { ToolContext } from '../../src/tools/types.js'

let directory: string
let jobs: DeviceJobService
let transfers: DeviceTransferService
let app: Hono
let context: ToolContext
let deviceId: string
const token = 'a'.repeat(43)
const otherToken = 'b'.repeat(43)
const sent = new Map<string, DeviceJobRequest>()

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'device-transfers-'))
  initDatabase(join(directory, 'test.sqlite'))
  const project = projectStore.create({ name: 'P', workDir: directory })
  const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock', projectId: project.id })
  const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
  context = { projectId: project.id, agentId: agent.id, sessionId: session.id }
  deviceId = deviceStore.create({ name: 'PC', shells: ['powershell'], publicKey: 'unused', tokenHash: hashDeviceSecret(token) }).id
  deviceStore.create({ name: 'Other', shells: ['powershell'], publicKey: 'unused', tokenHash: hashDeviceSecret(otherToken) })
  sent.clear()
  jobs = new DeviceJobService({ online: (): boolean => true, send: (id, frame): void => {
    sent.set(String(frame.jobId), frame.request as DeviceJobRequest)
    jobs.message(id, { type: 'job.state', jobId: frame.jobId, state: 'running', result: {} })
  } }, join(directory, 'logs'))
  transfers = new DeviceTransferService(jobs, join(directory, 'files'), { maxFileBytes: 64, quotaBytes: 128 })
  app = new Hono()
  transfers.mount(app)
})

afterEach(() => {
  transfers.close()
  jobs.close()
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(directory, { recursive: true, force: true })
})

async function upload(): Promise<{ url: string; ticket: string }> {
  const job = await transfers.submit({ deviceId, type: 'file.upload', localPath: 'C:\\test.txt' }, context) as { jobId: string }
  await vi.waitFor(() => expect(sent.has(job.jobId)).toBe(true))
  return sent.get(job.jobId)!.transfer!
}

function request(transfer: { url: string; ticket: string }, options: { method?: string; token?: string; body?: string; hash?: string } = {}): Promise<Response> {
  const body = options.body ?? 'valid file'
  const method = options.method ?? 'PUT'
  return Promise.resolve(app.request(transfer.url, { method, headers: {
    Authorization: `Bearer ${options.token ?? token}`, 'x-device-ticket': transfer.ticket,
    'Content-Length': String(Buffer.byteLength(body)),
    'x-file-sha256': options.hash ?? createHash('sha256').update(body).digest('hex'),
  }, ...(method === 'PUT' ? { body } : {}) }))
}

describe('device transfer authorization and bounds', () => {
  it('binds tickets to the device and direction, and allows only one use', async () => {
    const transfer = await upload()
    expect((await request(transfer, { token: otherToken })).status).toBe(401)
    expect((await request({ ...transfer, ticket: 'wrong' })).status).toBe(401)
    expect((await request(transfer, { method: 'GET' })).status).toBe(405)
    expect((await request(transfer)).status).toBe(200)
    expect((await request(transfer)).status).toBe(409)
  })

  it('expires an unused ticket without accepting any file', async () => {
    const transfer = await upload()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 301_000)
    expect((await request(transfer)).status).toBe(409)
  })

  it('rejects oversized and hash-mismatched files', async () => {
    const oversized = await upload()
    expect((await request(oversized, { body: 'x'.repeat(65) })).status).toBe(400)
    const corrupted = await upload()
    expect((await request(corrupted, { hash: '0'.repeat(64) })).status).toBe(400)
  })

  it('reserves temporary capacity before accepting a transfer', async () => {
    transfers.close()
    transfers = new DeviceTransferService(jobs, join(directory, 'files'), { maxFileBytes: 64, quotaBytes: 63 })
    await expect(transfers.submit({ deviceId, type: 'file.upload', localPath: 'C:\\test.txt' }, context)).rejects.toThrow('配额')
    expect(sent.size).toBe(0)
  })
})
