import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { startGateway } from '../../src/gateway/server.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'

const ACCESS_TOKEN = 'file-upload-secret'
let tmp: string
let server: Server | undefined

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-file-upload-http-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(async () => {
  if (server) await new Promise<void>((done) => server?.close(() => done()))
  server = undefined
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('Session file upload HTTP route', () => {
  test('requires owner authentication and saves a file for the matching Session project', async () => {
    const { projectId, sessionId } = createSessionFixture()
    await startTestGateway()
    const url = uploadUrl({ projectId, sessionId, name: 'notes.txt' })

    const unauthorized = await fetch(url, { method: 'POST', body: 'private' })
    const uploaded = await fetch(url, {
      method: 'POST',
      body: 'hello',
      headers: {
        'Content-Type': 'text/plain',
        'x-ai-ide-token': ACCESS_TOKEN,
      },
    })

    expect(unauthorized.status).toBe(401)
    expect(uploaded.status).toBe(201)
    const body = await uploaded.json() as { data: { name: string; path: string; size: number } }
    expect(body.data).toMatchObject({ name: 'notes.txt', size: 5 })
    expect(readFileSync(body.data.path, 'utf8')).toBe('hello')
  })

  test('rejects a Session from another project', async () => {
    const { sessionId } = createSessionFixture()
    const other = projectStore.create({ name: 'Other', workDir: resolve(tmp, 'other') })
    await startTestGateway()

    const response = await fetch(uploadUrl({ projectId: other.id, sessionId, name: 'notes.txt' }), {
      method: 'POST',
      body: 'hello',
      headers: { 'x-ai-ide-token': ACCESS_TOKEN },
    })

    expect(response.status).toBe(409)
  })
})

function createSessionFixture(): { projectId: string; sessionId: string } {
  const project = projectStore.create({ name: 'Project', workDir: resolve(tmp, 'workspace') })
  const agent = agentStore.create({ name: 'Codex', type: 'dev', runtime: 'mock', projectId: project.id })
  const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
  return { projectId: project.id, sessionId: session.id }
}

async function startTestGateway(): Promise<void> {
  const handle = await startGateway({
    host: '127.0.0.1',
    port: 0,
    dataDir: tmp,
    runtime: 'web',
    localToken: ACCESS_TOKEN,
  })
  server = handle.server
}

function uploadUrl(input: { projectId: string; sessionId: string; name: string }): string {
  const address = server?.address()
  if (!address || typeof address === 'string') throw new Error('test server not listening')
  const params = new URLSearchParams(input)
  return `http://127.0.0.1:${address.port}/api/v1/session-files?${params}`
}
