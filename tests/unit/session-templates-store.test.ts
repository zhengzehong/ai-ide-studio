import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { sessionTemplateStore } from '../../src/store/session-templates.js'
import { sessionStore } from '../../src/store/sessions.js'
import { agentStore } from '../../src/store/agents.js'

function setupTestDb(): string {
  const dir = join(tmpdir(), `ai-ide-session-templates-store-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

function createAgent(runtime = 'claude', projectId?: string): string {
  const agent = agentStore.create({
    type: 'test',
    name: `tester-${Math.random().toString(36).slice(2, 6)}`,
    runtime,
    projectId,
  })
  return agent.id
}

function createSession(agentId: string, opts: { acpSessionId?: string; projectId?: string; isTemplate?: boolean } = {}): string {
  const session = sessionStore.create({
    agentId,
    projectId: opts.projectId,
    acpSessionId: opts.acpSessionId,
    isTemplate: opts.isTemplate,
    title: 'src session',
  })
  return session.id
}

describe('sessionTemplateStore', () => {
  let dir: string
  let agentId: string
  let sourceSessionId: string
  let templateSessionId: string

  beforeEach(() => {
    dir = setupTestDb()
    agentId = createAgent()
    sourceSessionId = createSession(agentId, { acpSessionId: 'acp-src-1' })
    templateSessionId = createSession(agentId, { acpSessionId: 'acp-tpl-1', isTemplate: true })
  })

  afterEach(() => {
    teardownTestDb(dir)
  })

  it('create + get:建模板能 get 回来,字段完整', () => {
    const before = new Date().toISOString()
    const tpl = sessionTemplateStore.create({
      name: '我的模板',
      description: '描述',
      agentId,
      projectId: null,
      runtime: 'claude',
      sourceSessionId,
      templateSessionId,
      icon: 'bot',
    })
    expect(tpl.id.startsWith('tpl-sess-')).toBe(true)
    expect(tpl.name).toBe('我的模板')
    expect(tpl.description).toBe('描述')
    expect(tpl.agent_id).toBe(agentId)
    expect(tpl.project_id).toBeNull()
    expect(tpl.runtime).toBe('claude')
    expect(tpl.source_session_id).toBe(sourceSessionId)
    expect(tpl.template_session_id).toBe(templateSessionId)
    expect(tpl.icon).toBe('bot')
    expect(tpl.use_count).toBe(0)
    expect(tpl.last_used_at).toBeNull()
    expect(tpl.created_at >= before).toBe(true)
    expect(tpl.updated_at >= before).toBe(true)

    const fetched = sessionTemplateStore.get(tpl.id)
    expect(fetched).toBeDefined()
    expect(fetched?.id).toBe(tpl.id)
    expect(fetched?.name).toBe('我的模板')
    expect(fetched?.description).toBe('描述')
    expect(fetched?.runtime).toBe('claude')
    expect(fetched?.icon).toBe('bot')
  })

  it('create with default description/icon: 默认 null', () => {
    const tpl = sessionTemplateStore.create({
      name: 'min',
      agentId,
      runtime: 'claude',
      sourceSessionId,
      templateSessionId,
    })
    expect(tpl.description).toBeNull()
    expect(tpl.icon).toBeNull()
    expect(tpl.project_id).toBeNull()
  })

  it('list 按 agentId 过滤:只返回该 Agent 的模板', () => {
    const otherAgent = createAgent()
    const otherSrc = createSession(otherAgent, { acpSessionId: 'acp-other-src' })
    const otherTplSession = createSession(otherAgent, { acpSessionId: 'acp-other-tpl', isTemplate: true })

    sessionTemplateStore.create({
      name: 'A1',
      agentId,
      runtime: 'claude',
      sourceSessionId,
      templateSessionId,
    })
    sessionTemplateStore.create({
      name: 'A2',
      agentId,
      runtime: 'claude',
      sourceSessionId,
      templateSessionId,
    })
    sessionTemplateStore.create({
      name: 'B1',
      agentId: otherAgent,
      runtime: 'claude',
      sourceSessionId: otherSrc,
      templateSessionId: otherTplSession,
    })

    const aList = sessionTemplateStore.list({ agentId })
    expect(aList.length).toBe(2)
    expect(aList.every((t) => t.agent_id === agentId)).toBe(true)
    expect(aList.map((t) => t.name).sort()).toEqual(['A1', 'A2'])

    const bList = sessionTemplateStore.list({ agentId: otherAgent })
    expect(bList.length).toBe(1)
    expect(bList[0].name).toBe('B1')
  })

  it('list 按 projectId 过滤:只返回该项目的模板', () => {
    const projectId = 'proj-test-1'
    const otherProjectId = 'proj-test-2'
    const srcInProj = createSession(agentId, { acpSessionId: 'acp-src-proj', projectId })
    const tplInProj = createSession(agentId, { acpSessionId: 'acp-tpl-proj', projectId, isTemplate: true })
    const srcInOther = createSession(agentId, { acpSessionId: 'acp-src-other', projectId: otherProjectId })
    const tplInOther = createSession(agentId, { acpSessionId: 'acp-tpl-other', projectId: otherProjectId, isTemplate: true })

    sessionTemplateStore.create({
      name: 'P1',
      agentId,
      projectId,
      runtime: 'claude',
      sourceSessionId: srcInProj,
      templateSessionId: tplInProj,
    })
    sessionTemplateStore.create({
      name: 'P2',
      agentId,
      projectId: otherProjectId,
      runtime: 'claude',
      sourceSessionId: srcInOther,
      templateSessionId: tplInOther,
    })

    const list = sessionTemplateStore.list({ projectId })
    expect(list.length).toBe(1)
    expect(list[0].name).toBe('P1')
    expect(list[0].project_id).toBe(projectId)
  })

  it('list 无 filter 返回全部', () => {
    sessionTemplateStore.create({
      name: 'A1',
      agentId,
      runtime: 'claude',
      sourceSessionId,
      templateSessionId,
    })
    sessionTemplateStore.create({
      name: 'A2',
      agentId,
      runtime: 'claude',
      sourceSessionId,
      templateSessionId,
    })
    const list = sessionTemplateStore.list()
    expect(list.length).toBe(2)
  })

  it('update 改 name/description/icon:字段更新正确', () => {
    const tpl = sessionTemplateStore.create({
      name: '原名',
      description: '原描述',
      agentId,
      runtime: 'claude',
      sourceSessionId,
      templateSessionId,
      icon: 'bot',
    })
    const updated = sessionTemplateStore.update(tpl.id, {
      name: '新名',
      description: '新描述',
      icon: 'code',
    })
    expect(updated).toBeDefined()
    expect(updated?.name).toBe('新名')
    expect(updated?.description).toBe('新描述')
    expect(updated?.icon).toBe('code')
    expect(updated?.updated_at >= tpl.updated_at).toBe(true)
  })

  it('update 把 description/icon 改成 null', () => {
    const tpl = sessionTemplateStore.create({
      name: 't',
      description: 'desc',
      agentId,
      runtime: 'claude',
      sourceSessionId,
      templateSessionId,
      icon: 'bot',
    })
    const updated = sessionTemplateStore.update(tpl.id, { description: null, icon: null })
    expect(updated?.description).toBeNull()
    expect(updated?.icon).toBeNull()
  })

  it('update 不存在的 id 返回 undefined', () => {
    const result = sessionTemplateStore.update('tpl-sess-not-exist', { name: 'x' })
    expect(result).toBeUndefined()
  })

  it('incrementUseCount: use_count +1, last_used_at 更新', async () => {
    const tpl = sessionTemplateStore.create({
      name: 't',
      agentId,
      runtime: 'claude',
      sourceSessionId,
      templateSessionId,
    })
    expect(tpl.use_count).toBe(0)
    expect(tpl.last_used_at).toBeNull()

    sessionTemplateStore.incrementUseCount(tpl.id)
    sessionTemplateStore.incrementUseCount(tpl.id)
    sessionTemplateStore.incrementUseCount(tpl.id)

    const after = sessionTemplateStore.get(tpl.id)
    expect(after?.use_count).toBe(3)
    expect(after?.last_used_at).toBeTruthy()
    expect(after?.updated_at >= tpl.updated_at).toBe(true)
  })

  it('delete:记录删除', () => {
    const tpl = sessionTemplateStore.create({
      name: 't',
      agentId,
      runtime: 'claude',
      sourceSessionId,
      templateSessionId,
    })
    expect(sessionTemplateStore.get(tpl.id)).toBeDefined()
    sessionTemplateStore.delete(tpl.id)
    expect(sessionTemplateStore.get(tpl.id)).toBeUndefined()
  })

  it('get 不存在的 id 返回 undefined', () => {
    expect(sessionTemplateStore.get('tpl-sess-not-exist')).toBeUndefined()
  })
})
