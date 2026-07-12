import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Hono } from 'hono'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { sessionShareStore } from '../../src/store/session-shares.js'
import { sessionShareManager } from '../../src/core/session-share-manager.js'
import { sessionStore } from '../../src/store/sessions.js'
import { agentStore } from '../../src/store/agents.js'
import { mountShareRoutes } from '../../src/gateway/share-routes.js'
import type { AppConfig } from '../../src/core/config.js'

function setupTestDb(): string {
  const dir = join(tmpdir(), `ai-ide-share-routes-perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  const dbPath = join(dir, 'test.db')
  closeDatabase()
  initDatabase(dbPath)
  return dir
}

function teardownTestDb(dir: string): void {
  closeDatabase()
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

function createApp(): Hono {
  const app = new Hono()
  mountShareRoutes(app, {} as AppConfig)
  return app
}

function createAgent(name: string): string {
  const agent = agentStore.create({ type: 'dev', name, runtime: 'mock' })
  return agent.id
}

function createSession(agentId: string): string {
  const session = sessionStore.create({ agentId, title: 'test session' })
  return session.id
}

describe('share-routes owner permission', () => {
  let dir: string
  let ownerAgentId: string
  let otherAgentId: string
  let sessionId: string
  let shareId: string

  beforeEach(() => {
    dir = setupTestDb()
    ownerAgentId = createAgent('owner-agent')
    otherAgentId = createAgent('other-agent')
    sessionId = createSession(ownerAgentId)
    const share = sessionShareManager.createShare({
      sessionId,
      ownerAgentId,
      shareName: 'test share',
      agentIntro: 'intro',
    })
    shareId = share.id
  })

  afterEach(() => {
    teardownTestDb(dir)
  })

  it('revoke: 同 owner 返回 200', async () => {
    const app = createApp()
    const res = await app.request(`/api/shares/${shareId}/revoke`, {
      method: 'POST',
      headers: { 'x-ai-ide-owner-agent-id': ownerAgentId },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(shareId)
    expect(body.revoked_at).toBeTruthy()
  })

  it('revoke: 跨 owner 返回 403', async () => {
    const app = createApp()
    const res = await app.request(`/api/shares/${shareId}/revoke`, {
      method: 'POST',
      headers: { 'x-ai-ide-owner-agent-id': otherAgentId },
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('无权')
  })

  it('revoke: 缺少 header 返回 403', async () => {
    const app = createApp()
    const res = await app.request(`/api/shares/${shareId}/revoke`, {
      method: 'POST',
    })
    expect(res.status).toBe(403)
  })

  it('renew: 跨 owner 返回 403,同 owner 返回 200', async () => {
    const app = createApp()
    // 跨 owner 失败
    const badRes = await app.request(`/api/shares/${shareId}/renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ai-ide-owner-agent-id': otherAgentId },
      body: JSON.stringify({ days: 7 }),
    })
    expect(badRes.status).toBe(403)
    // 同 owner 成功
    const okRes = await app.request(`/api/shares/${shareId}/renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ai-ide-owner-agent-id': ownerAgentId },
      body: JSON.stringify({ days: 7 }),
    })
    expect(okRes.status).toBe(200)
    const body = await okRes.json()
    expect(body.expires_at).toBeTruthy()
  })

  it('DELETE: 跨 owner 返回 403,同 owner 返回 200', async () => {
    const app = createApp()
    // 跨 owner 失败
    const badRes = await app.request(`/api/shares/${shareId}`, {
      method: 'DELETE',
      headers: { 'x-ai-ide-owner-agent-id': otherAgentId },
    })
    expect(badRes.status).toBe(403)
    // 同 owner 成功
    const okRes = await app.request(`/api/shares/${shareId}`, {
      method: 'DELETE',
      headers: { 'x-ai-ide-owner-agent-id': ownerAgentId },
    })
    expect(okRes.status).toBe(200)
    const body = await okRes.json()
    expect(body.ok).toBe(true)
    // DB 应标记 deleted_at
    const after = sessionShareStore.getById(shareId)
    expect(after?.deleted_at).toBeTruthy()
  })

  it('revoke: 不存在的 share 返回 404(不泄漏 owner 信息)', async () => {
    const app = createApp()
    const res = await app.request(`/api/shares/shr-nonexistent/revoke`, {
      method: 'POST',
      headers: { 'x-ai-ide-owner-agent-id': ownerAgentId },
    })
    expect(res.status).toBe(404)
  })
})
