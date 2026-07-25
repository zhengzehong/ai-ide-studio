import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { previewStore } from '../../src/store/previews.js'
import { startGateway } from '../../src/gateway/server.js'

let tmp: string
let server: Server | undefined

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-preview-assets-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolveClose) => server?.close(() => resolveClose()))
    server = undefined
  }
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('preview asset authentication', () => {
  test('root token bootstraps a scoped cookie for relative CSS assets', async () => {
    const sourcePath = resolve(tmp, 'prototype')
    mkdirSync(sourcePath)
    writeFileSync(resolve(sourcePath, 'index.html'), '<link rel="stylesheet" href="styles.css">')
    writeFileSync(resolve(sourcePath, 'styles.css'), 'body { color: red; }')
    const preview = previewStore.create({ projectId: 'project-preview', title: 'Preview', sourcePath })
    const handle = await startGateway({ host: '127.0.0.1', port: 0, dataDir: tmp, runtime: 'web', localToken: 'preview-secret' })
    server = handle.server
    if (!server.listening) await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('gateway port unavailable')
    const base = `http://127.0.0.1:${address.port}`

    const root = await fetch(`${base}/preview/${preview.id}/?token=preview-secret`)
    const cookie = root.headers.get('set-cookie')
    expect(root.status).toBe(200)
    expect(cookie).toContain('ai-ide-preview-token=preview-secret')
    expect(cookie).toContain(`Path=/preview/${preview.id}/`)

    const unauthorized = await fetch(`${base}/preview/${preview.id}/styles.css`)
    const css = await fetch(`${base}/preview/${preview.id}/styles.css`, {
      headers: { Cookie: cookie?.split(';', 1)[0] ?? '' },
    })
    expect(unauthorized.status).toBe(401)
    expect(css.status).toBe(200)
    expect(await css.text()).toContain('color: red')
  })
})
