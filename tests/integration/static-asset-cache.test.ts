import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startGateway } from '../../src/gateway/server.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'

let tmp: string | undefined
let server: Server | undefined

afterEach(async () => {
  if (server) await new Promise<void>((resolveClose) => server?.close(() => resolveClose()))
  server = undefined
  closeDatabase()
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = undefined
})

describe('static asset response cache policy', () => {
  it('serves immutable hashed assets and revalidated SPA HTML', async () => {
    tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-static-cache-'))
    const staticDir = resolve(tmp, 'dist')
    mkdirSync(resolve(staticDir, 'assets'), { recursive: true })
    writeFileSync(resolve(staticDir, 'index.html'), '<html><body>app</body></html>')
    writeFileSync(resolve(staticDir, 'assets/index-12345678.js'), 'export {}')
    initDatabase(resolve(tmp, 'test.sqlite'))
    const handle = await startGateway({
      host: '127.0.0.1',
      port: 0,
      dataDir: tmp,
      runtime: 'web',
      staticDir,
    })
    server = handle.server

    const asset = await fetch(`${baseUrl()}/assets/index-12345678.js`)
    const spa = await fetch(`${baseUrl()}/p/project-1/workspace`)

    expect(asset.status).toBe(200)
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(spa.status).toBe(200)
    expect(spa.headers.get('cache-control')).toBe('no-cache')
    expect(await spa.text()).toContain('<body>app</body>')
  })
})

function baseUrl(): string {
  const address = server?.address()
  if (!address || typeof address === 'string') throw new Error('test server not listening')
  return `http://127.0.0.1:${address.port}`
}
