import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { deviceStore } from '../../src/store/devices.js'
import { deviceJobStore } from '../../src/store/device-jobs.js'
import { DeviceJobService } from '../../src/devices/job-service.js'
import { MAX_DEVICE_LOG_BYTES } from '../../src/devices/protocol.js'
import type { ToolContext } from '../../src/tools/types.js'

let directory: string
let jobs: DeviceJobService
let deviceId: string
let context: ToolContext
const send = vi.fn()
const online = vi.fn(() => true)

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'device-jobs-'))
  initDatabase(join(directory, 'test.sqlite'))
  const project = projectStore.create({ name: 'P', workDir: directory })
  const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock', projectId: project.id })
  const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
  context = { projectId: project.id, sessionId: session.id, agentId: agent.id }
  deviceId = deviceStore.create({ name: 'PC', shells: ['powershell'], publicKey: 'test', tokenHash: 'hash' }).id
  send.mockReset(); online.mockReturnValue(true)
  jobs = new DeviceJobService({ send, online }, join(directory, 'logs'))
})
afterEach(() => { jobs.close(); closeDatabase(); rmSync(directory, { recursive: true, force: true }); vi.useRealTimers() })

function create(): ReturnType<typeof jobs.create> {
  return jobs.create(deviceId, { type: 'shell', command: 'echo', shell: 'powershell', timeoutSeconds: 60 }, context)
}

describe('device job state boundaries', () => {
  it('persists before send, returns after five seconds, and bounds concurrency', async () => {
    vi.useFakeTimers()
    const job = create()
    send.mockImplementation(() => expect(deviceJobStore.get(job.id)).toBeDefined())
    const pending = jobs.dispatch(job, JSON.parse(job.request_json), false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await pending).toMatchObject({ jobId: job.id, state: 'queued' })
    create()
    expect(() => create()).toThrow('忙')
  })

  it('rejects cross-device results and cross-session queries; terminal status cannot regress', () => {
    const job = create()
    expect(() => jobs.message('different', { type: 'job.state', jobId: job.id, state: 'succeeded' })).toThrow('不属于')
    expect(() => jobs.status(deviceId, job.id, { ...context, sessionId: 'other' })).toThrow('不属于')
    jobs.message(deviceId, { type: 'job.state', jobId: job.id, state: 'succeeded', result: { exitCode: 0 } })
    jobs.message(deviceId, { type: 'job.state', jobId: job.id, state: 'running', result: {} })
    expect(deviceJobStore.get(job.id)?.state).toBe('succeeded')
  })

  it('retains cwd on disconnect and reconnects by query, never by re-submission', () => {
    const job = create()
    jobs.message(deviceId, { type: 'job.state', jobId: job.id, state: 'running', result: { cwd: 'C:\\Users\\local' } })
    jobs.disconnected(deviceId)
    expect(jobs.status(deviceId, job.id, context)).toMatchObject({ state: 'unknown', cwd: 'C:\\Users\\local' })
    jobs.connected(deviceId)
    expect(send).toHaveBeenCalledExactlyOnceWith(deviceId, { type: 'job.query', jobId: job.id, cursor: 0 })
    jobs.close()
    jobs = new DeviceJobService({ send, online }, join(directory, 'logs'))
    expect(deviceJobStore.get(job.id)?.state).toBe('unknown')
  })

  it('cancellation is not success until the client confirms, and offline does not fall back', () => {
    const job = create()
    expect(jobs.cancel(deviceId, job.id, context)).toMatchObject({ state: 'cancel_requested' })
    jobs.message(deviceId, { type: 'job.state', jobId: job.id, state: 'running', result: {} })
    expect(deviceJobStore.get(job.id)?.state).toBe('cancel_requested')
    jobs.message(deviceId, { type: 'job.state', jobId: job.id, state: 'cancelled', result: {} })
    expect(deviceJobStore.get(job.id)?.state).toBe('cancelled')
    online.mockReturnValue(false)
    expect(() => create()).toThrow('离线')
  })

  it('allows new diagnostics after unknown historical jobs without replaying them', () => {
    const first = create()
    create()
    jobs.disconnected(deviceId)
    const diagnostic = create()
    expect(diagnostic.state).toBe('queued')
    expect(deviceJobStore.get(first.id)?.state).toBe('unknown')
    expect(send).not.toHaveBeenCalled()
  })

  it('deduplicates logs and paginates UTF-8 without killing jobs at the log limit', () => {
    const job = create()
    const text = 'a'.repeat(32767) + '中文结果'
    jobs.logs.append(job.id, 0, text)
    jobs.logs.append(job.id, 0, text)
    const first = jobs.logs.read(job.id)
    const second = jobs.logs.read(job.id, first.nextCursor)
    expect(first.output + second.output).toBe(text)
    expect(() => jobs.logs.append(job.id, 99_999, 'gap')).toThrow('不连续')
    const offset = jobs.logs.size(job.id)
    jobs.logs.append(job.id, offset, 'x'.repeat(MAX_DEVICE_LOG_BYTES))
    expect(jobs.logs.size(job.id)).toBe(MAX_DEVICE_LOG_BYTES)
    expect(deviceJobStore.get(job.id)?.state).toBe('queued')
  })
})
