import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { startGateway } from '../../src/gateway/server.js'
import { createFileAssetUrl } from '../../src/gateway/file-asset-signing.js'

let tmp: string
let server: Server | undefined

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-file-assets-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(async () => {
  if (server) await new Promise<void>((done) => server?.close(() => done()))
  server = undefined
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('signed file assets', () => {
  test('streams an authenticated absolute file range without exposing the local token', async () => {
    const mediaPath = resolve(tmp, 'outside.mp4')
    writeFileSync(mediaPath, Buffer.from('0123456789'))
    const project = projectStore.create({ name: 'Media', workDir: resolve(tmp, 'workspace') })
    const handle = await startGateway({
      host: '127.0.0.1', port: 0, dataDir: tmp, runtime: 'web', localToken: 'asset-secret',
    })
    server = handle.server
    if (!server.listening) await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('gateway port unavailable')
    const ticket = createFileAssetUrl({ projectId: project.id, path: mediaPath, mode: 'inline' })

    expect(ticket.url).not.toContain('asset-secret')
    const response = await fetch(`http://127.0.0.1:${address.port}${ticket.url}`, {
      headers: { Range: 'bytes=2-5' },
    })

    expect(response.status).toBe(206)
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(response.headers.get('content-length')).toBe('4')
    expect(response.headers.get('content-type')).toContain('video/mp4')
    expect(await response.text()).toBe('2345')

    const legacy = new URL(`http://127.0.0.1:${address.port}/api/fs/asset`)
    legacy.searchParams.set('projectId', project.id)
    legacy.searchParams.set('path', mediaPath)
    legacy.searchParams.set('token', 'asset-secret')
    expect((await fetch(legacy)).status).toBe(200)
  })

  test('rejects invalid ranges and tampered signed paths', async () => {
    const mediaPath = resolve(tmp, 'outside.mp4')
    writeFileSync(mediaPath, Buffer.from('0123456789'))
    const project = projectStore.create({ name: 'Media', workDir: resolve(tmp, 'workspace') })
    const handle = await startGateway({
      host: '127.0.0.1', port: 0, dataDir: tmp, runtime: 'web', localToken: 'asset-secret',
    })
    server = handle.server
    if (!server.listening) await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('gateway port unavailable')
    const base = `http://127.0.0.1:${address.port}`
    const ticket = createFileAssetUrl({ projectId: project.id, path: mediaPath, mode: 'inline' })

    const invalidRange = await fetch(`${base}${ticket.url}`, { headers: { Range: 'bytes=99-100' } })
    const tampered = new URL(`${base}${ticket.url}`)
    tampered.searchParams.set('path', resolve(tmp, 'other.mp4'))
    const invalidSignature = await fetch(tampered)

    expect(invalidRange.status).toBe(416)
    expect(invalidRange.headers.get('content-range')).toBe('bytes */10')
    expect(invalidSignature.status).toBe(401)
  })
})
