import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { startGateway } from '../../src/gateway/server.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { readingItemStore } from '../../src/store/reading-items.js'
import { sessionStore } from '../../src/store/sessions.js'

let tmp: string
let server: Server | undefined

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-reading-assets-'))
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

describe('reading mounted assets', () => {
  test('uses a scoped cookie for the entry file and relative assets', async () => {
    const sourcePath = resolve(tmp, 'article')
    mkdirSync(sourcePath)
    writeFileSync(resolve(sourcePath, 'index.html'), '<link rel="stylesheet" href="styles.css"><h1>教程</h1>')
    writeFileSync(resolve(sourcePath, 'styles.css'), 'body { color: green; }')
    const item = createLocalItem(sourcePath, 'index.html', 'html')
    const base = await start()

    const root = await fetch(`${base}/reading/${item.id}/?token=reading-secret`)
    const cookie = root.headers.get('set-cookie')
    expect(root.status).toBe(200)
    expect(cookie).toContain('ai-ide-reading-token=reading-secret')
    expect(cookie).toContain(`Path=/reading/${item.id}/`)

    const unauthorized = await fetch(`${base}/reading/${item.id}/styles.css`)
    const css = await fetch(`${base}/reading/${item.id}/styles.css`, {
      headers: { Cookie: cookie?.split(';', 1)[0] ?? '' },
    })
    expect(unauthorized.status).toBe(401)
    expect(css.status).toBe(200)
    expect(await css.text()).toContain('color: green')
  })

  test('serves Markdown text but rejects traversal, missing files, and URL items', async () => {
    const sourcePath = resolve(tmp, 'markdown')
    mkdirSync(sourcePath)
    writeFileSync(resolve(sourcePath, 'guide.md'), '# Markdown 教程')
    writeFileSync(resolve(tmp, 'outside.txt'), 'secret')
    const markdown = createLocalItem(sourcePath, 'guide.md', 'md')
    const source = createSource()
    const urlItem = readingItemStore.create({
      ...source,
      title: '链接',
      format: 'url',
      url: 'https://example.com',
    })
    const base = await start()

    const md = await fetch(`${base}/reading/${markdown.id}/?token=reading-secret`)
    expect(md.status).toBe(200)
    expect(md.headers.get('content-type')).toContain('text/markdown')
    expect(await md.text()).toContain('Markdown 教程')

    const traversal = await fetch(`${base}/reading/${markdown.id}/%2e%2e%2foutside.txt?token=reading-secret`)
    expect(traversal.status).toBe(400)
    const missing = await fetch(`${base}/reading/${markdown.id}/missing.png?token=reading-secret`)
    expect(missing.status).toBe(404)
    const external = await fetch(`${base}/reading/${urlItem.id}/?token=reading-secret`)
    expect(external.status).toBe(400)
  })
})

function createSource() {
  const project = projectStore.create({ name: '阅读资源项目', workDir: tmp })
  const agent = agentStore.create({ type: 'developer', name: 'Agent', runtime: 'codex', projectId: project.id })
  const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
  return { projectId: project.id, agentId: agent.id, sessionId: session.id }
}

function createLocalItem(sourcePath: string, entryFile: string, format: 'md' | 'html') {
  return readingItemStore.create({
    ...createSource(),
    title: entryFile,
    format,
    mountPath: sourcePath,
    entryFile,
  })
}

async function start(): Promise<string> {
  const handle = await startGateway({
    host: '127.0.0.1',
    port: 0,
    dataDir: tmp,
    runtime: 'web',
    localToken: 'reading-secret',
  })
  server = handle.server
  if (!server.listening) await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('gateway port unavailable')
  return `http://127.0.0.1:${address.port}`
}
