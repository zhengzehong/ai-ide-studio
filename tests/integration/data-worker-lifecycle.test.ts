import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppHandle } from '../../src/app.js'
import { startApp } from '../../src/app.js'
import { getDatabaseMode } from '../../src/store/db.js'

let tmp: string | undefined
let handle: AppHandle | undefined

afterEach(async () => {
  await handle?.stop()
  handle = undefined
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = undefined
})

describe('application data worker lifecycle', () => {
  it('starts worker-backed HTTP only after readiness and releases database resources on stop', async () => {
    tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-data-worker-app-'))
    handle = await startApp({
      host: '127.0.0.1',
      port: 0,
      dataDir: tmp,
      runtime: 'web',
      dataWorkerMode: 'worker',
    })

    const health = await fetch(`${baseUrl(handle)}/health`)
    const tasks = await fetch(`${baseUrl(handle)}/api/v1/tasks`)

    expect(handle.dataWorkerMode).toBe('worker')
    expect(health.status).toBe(200)
    expect(tasks.status).toBe(200)
    expect(await tasks.json()).toMatchObject({ data: [] })

    await handle.stop()
    expect(getDatabaseMode()).toBeNull()
    await expect(handle.stop()).resolves.toBeUndefined()
    handle = undefined
  })

  it('supports an explicit local rollback mode without changing HTTP contracts', async () => {
    tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-local-data-app-'))
    handle = await startApp({
      host: '127.0.0.1',
      port: 0,
      dataDir: tmp,
      runtime: 'web',
      dataWorkerMode: 'local',
    })

    const sessions = await fetch(`${baseUrl(handle)}/api/v1/sessions`)

    expect(handle.dataWorkerMode).toBe('local')
    expect(sessions.status).toBe(200)
    expect(await sessions.json()).toMatchObject({ data: [] })
  })
})

function baseUrl(app: AppHandle): string {
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('test app is not listening')
  return `http://127.0.0.1:${address.port}`
}
