import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase, getDb, closeDatabase } from '../../src/store/db.js'
import { sessionStore } from '../../src/store/sessions.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'

function setupTestDb(): string {
  const dir = join(tmpdir(), `ai-ide-session-is-template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

describe('sessions.is_template 基础设施', () => {
  let dir: string

  beforeEach(() => {
    dir = setupTestDb()
  })

  afterEach(() => {
    teardownTestDb(dir)
  })

  it('普通会话 is_template 默认为 0', () => {
    const agent = agentStore.create({ type: 'test', name: 'tester', runtime: 'claude' })
    const session = sessionStore.create({ agentId: agent.id })
    expect(session.is_template).toBe(0)
  })

  it('创建时可通过 isTemplate: true 标记模板会话', () => {
    const agent = agentStore.create({ type: 'test', name: 'tester', runtime: 'claude' })
    const session = sessionStore.create({ agentId: agent.id, isTemplate: true })
    expect(session.is_template).toBe(1)
  })

  it('list/listWithRuntimeState 默认过滤 is_template=1 的会话', () => {
    const agent = agentStore.create({ type: 'test', name: 'tester', runtime: 'claude' })
    const normal = sessionStore.create({ agentId: agent.id, acpSessionId: 'acp-normal' })
    const template = sessionStore.create({ agentId: agent.id, isTemplate: true, acpSessionId: 'acp-template' })

    const list = sessionStore.list(agent.id)
    const ids = list.map((s) => s.id)
    expect(ids).toContain(normal.id)
    expect(ids).not.toContain(template.id)

    const withRuntime = sessionStore.listWithRuntimeState(agent.id)
    const runtimeIds = withRuntime.map((s) => s.id)
    expect(runtimeIds).toContain(normal.id)
    expect(runtimeIds).not.toContain(template.id)
  })

  it('模板会话可按 project 过滤,不影响其他项目普通会话', () => {
    const project = projectStore.create({ name: 'P', workDir: dir })
    const agent = agentStore.create({ type: 'test', name: 'tester', runtime: 'claude', projectId: project.id })
    const normal = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const tpl = sessionStore.create({ agentId: agent.id, projectId: project.id, isTemplate: true })

    const list = sessionStore.list(agent.id, project.id)
    expect(list.map((s) => s.id)).toContain(normal.id)
    expect(list.map((s) => s.id)).not.toContain(tpl.id)
  })

  it('session_templates 表结构 + 索引', () => {
    const columns = getDb().prepare<[], { name: string }>('PRAGMA table_info(session_templates)').all().map((r) => r.name)
    expect(columns).toEqual(expect.arrayContaining([
      'id', 'name', 'description', 'agent_id', 'project_id', 'runtime',
      'source_session_id', 'template_session_id', 'icon', 'use_count',
      'last_used_at', 'created_at', 'updated_at',
    ]))

    const indexes = getDb().prepare<[], { name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'session_templates'`,
    ).all().map((r) => r.name)
    expect(indexes).toEqual(expect.arrayContaining([
      'idx_session_templates_agent',
      'idx_session_templates_project',
    ]))
  })
})
