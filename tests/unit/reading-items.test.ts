import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import type { ToolContext, ToolHandlerResult } from '../../src/tools/types.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-reading-items-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('reading_items migration', () => {
  test('creates one metadata table with the confirmed source and state fields', () => {
    const columns = getDb()
      .prepare<[], { name: string }>('PRAGMA table_info(reading_items)')
      .all()
      .map((column) => column.name)

    expect(columns).toEqual([
      'id', 'project_id', 'session_id', 'agent_id', 'title', 'summary',
      'format', 'mount_path', 'entry_file', 'url', 'status',
      'created_at', 'updated_at', 'read_at', 'archived_at',
    ])
  })
})

describe('reading.add', () => {
  test('registers a Markdown file using the current project, Session, and Agent', async () => {
    const context = createContext()
    const filePath = resolve(tmp, 'docs', 'guide.md')
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, '# 阅读指南\n\n这是由 Agent 生成的第一段摘要。')

    const result = await executeJson({ title: '阅读指南', type: 'md', content: filePath }, context)

    expect(result).toMatchObject({ title: '阅读指南', format: 'md', status: 'unread' })
    expect(result.readingId).toMatch(/^read-/)
    const row = getDb().prepare<[string], ReadingRow>('SELECT * FROM reading_items WHERE id = ?').get(result.readingId as string)
    expect(row).toMatchObject({
      project_id: context.projectId,
      session_id: context.sessionId,
      agent_id: context.agentId,
      title: '阅读指南',
      format: 'md',
      mount_path: dirname(filePath),
      entry_file: 'guide.md',
      url: null,
      status: 'unread',
    })
    expect(row?.summary).toContain('这是由 Agent 生成的第一段摘要')
  })

  test('registers local .html and .htm files as mounted HTML entries', async () => {
    const context = createContext()
    for (const name of ['article.html', 'legacy.htm']) {
      const filePath = resolve(tmp, 'html', name)
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, '<html><body><h1>本地教程</h1><p>正文内容</p></body></html>')

      const result = await executeJson({ title: name, type: 'html', content: filePath }, context)
      const row = getDb().prepare<[string], ReadingRow>('SELECT * FROM reading_items WHERE id = ?').get(result.readingId as string)
      expect(row).toMatchObject({ format: 'html', mount_path: dirname(filePath), entry_file: name, url: null })
      expect(row?.summary).toContain('本地教程')
    }
  })

  test('registers an HTTPS URL without a mounted path', async () => {
    const context = createContext()
    const result = await executeJson({
      title: 'React 文档',
      type: 'url',
      content: 'https://react.dev/learn?source=studio',
    }, context)

    const row = getDb().prepare<[string], ReadingRow>('SELECT * FROM reading_items WHERE id = ?').get(result.readingId as string)
    expect(row).toMatchObject({
      format: 'url',
      mount_path: null,
      entry_file: null,
      url: 'https://react.dev/learn?source=studio',
    })
    expect(row?.summary).toContain('react.dev')
  })

  test('rejects unsupported paths, protocols, and missing Session context', async () => {
    const context = createContext()
    const textFile = resolve(tmp, 'notes.txt')
    writeFileSync(textFile, 'not markdown')

    expect(await executeError({ title: '错', type: 'md', content: textFile }, context)).toContain('.md')
    expect(await executeError({ title: '错', type: 'url', content: 'http://example.com' }, context)).toContain('HTTPS')
    expect(await executeError({ title: '错', type: 'url', content: 'javascript:alert(1)' }, context)).toContain('HTTPS')
    expect(await executeError({ title: '错', type: 'url', content: 'https://example.com' }, {
      projectId: context.projectId,
      agentId: context.agentId,
    })).toContain('sessionId')
  })
})

interface ReadingRow {
  project_id: string | null
  session_id: string
  agent_id: string
  title: string
  summary: string
  format: 'md' | 'html' | 'url'
  mount_path: string | null
  entry_file: string | null
  url: string | null
  status: 'unread' | 'read' | 'archived'
}

function createContext(): ToolContext {
  const project = projectStore.create({ name: '阅读项目', workDir: tmp })
  const agent = agentStore.create({ type: 'developer', name: '阅读 Agent', runtime: 'codex', projectId: project.id })
  const session = sessionStore.create({ agentId: agent.id, projectId: project.id, title: '来源会话' })
  return { projectId: project.id, agentId: agent.id, sessionId: session.id, workDir: tmp }
}

async function executeRaw(input: Record<string, unknown>, context: ToolContext): Promise<ToolHandlerResult> {
  const handler = getHandler('reading.add')
  expect(handler, 'reading.add handler must be registered').toBeDefined()
  if (!handler) throw new Error('reading.add handler missing')
  return handler.execute(input, context)
}

async function executeJson(input: Record<string, unknown>, context: ToolContext): Promise<Record<string, unknown>> {
  const result = await executeRaw(input, context)
  expect(result.isError).not.toBe(true)
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}

async function executeError(input: Record<string, unknown>, context: ToolContext): Promise<string> {
  const result = await executeRaw(input, context)
  expect(result.isError).toBe(true)
  const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { error?: string }
  return parsed.error ?? ''
}
