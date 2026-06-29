import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { previewStore } from '../../src/store/previews.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import type { ToolContext, ToolHandlerResult } from '../../src/tools/types.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-preview-store-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('previewStore basic CRUD', () => {
  test('create writes a preview with prev- prefix and default entry_file', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const row = previewStore.create({
      projectId: project.id,
      title: '预览1',
      sourcePath: resolve(tmp, 'preview1'),
    })

    expect(row.id).toMatch(/^prev-/)
    expect(row.project_id).toBe(project.id)
    expect(row.title).toBe('预览1')
    expect(row.entry_file).toBe('index.html')
    expect(row.target).toBe('pc')
    expect(row.task_id).toBeNull()
    expect(row.description).toBeNull()
    expect(row.created_at).toBeTruthy()
  })

  test('get returns the created row', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const row = previewStore.create({
      projectId: project.id,
      title: 'A',
      sourcePath: resolve(tmp, 'a'),
    })
    const fetched = previewStore.get(row.id)
    expect(fetched?.id).toBe(row.id)
    expect(fetched?.title).toBe('A')
  })

  test('get returns undefined for unknown id', () => {
    expect(previewStore.get('prev-nope')).toBeUndefined()
  })

  test('list returns previews ordered by created_at DESC', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const a = previewStore.create({ projectId: project.id, title: 'A', sourcePath: resolve(tmp, 'a') })
    await new Promise((r) => setTimeout(r, 5))
    const b = previewStore.create({ projectId: project.id, title: 'B', sourcePath: resolve(tmp, 'b') })

    const list = previewStore.list(project.id)
    expect(list.map((row) => row.id)).toEqual([b.id, a.id])
  })

  test('list filters by taskId when provided', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const a = previewStore.create({ projectId: project.id, title: 'A', sourcePath: resolve(tmp, 'a'), taskId: 'task-1' })
    const b = previewStore.create({ projectId: project.id, title: 'B', sourcePath: resolve(tmp, 'b'), taskId: 'task-2' })
    const c = previewStore.create({ projectId: project.id, title: 'C', sourcePath: resolve(tmp, 'c'), taskId: null })

    expect(previewStore.list(project.id, 'task-1').map((row) => row.id)).toEqual([a.id])
    expect(previewStore.list(project.id, 'task-2').map((row) => row.id)).toEqual([b.id])
    expect(previewStore.list(undefined, 'task-1').map((row) => row.id)).toEqual([a.id])
    expect(previewStore.list(project.id).map((row) => row.id)).toHaveLength(3)
    expect(previewStore.list(project.id).map((row) => row.id)).toContain(c.id)
  })

  test('listByTask returns previews for the given task ordered DESC', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const t = 'task-list-by-task'
    const a = previewStore.create({ projectId: project.id, title: 'A', sourcePath: resolve(tmp, 'a'), taskId: t })
    await new Promise((r) => setTimeout(r, 5))
    const b = previewStore.create({ projectId: project.id, title: 'B', sourcePath: resolve(tmp, 'b'), taskId: t })

    const list = previewStore.listByTask(t)
    expect(list.map((row) => row.id)).toEqual([b.id, a.id])
  })

  test('delete removes the row', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const row = previewStore.create({ projectId: project.id, title: 'A', sourcePath: resolve(tmp, 'a') })
    previewStore.delete(row.id)
    expect(previewStore.get(row.id)).toBeUndefined()
  })
})

describe('preview.publish handler', () => {
  test('publishes a directory with default entry file', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const previewDir = resolve(tmp, 'preview-dir')
    mkdirSync(previewDir)
    writeFileSync(resolve(previewDir, 'index.html'), '<h1>hello</h1>')

    const result = await executeJson('preview.publish', {
      sourcePath: previewDir,
      title: '目录预览',
    }, { projectId: project.id, agentId: 'agent-test' })

    expect(result.previewId).toMatch(/^prev-/)
    expect(result.url).toContain(`/preview/${result.previewId}/`)
    expect(result.title).toBe('目录预览')
    expect(result.target).toBe('pc')
    expect(result.taskId).toBeNull()
    expect(result.createdAt).toBeTruthy()

    const stored = previewStore.get(result.previewId)
    expect(stored?.entry_file).toBe('index.html')
    expect(stored?.source_path).toBe(previewDir)
    expect(stored?.created_by_agent_id).toBe('agent-test')
  })

  test('publishes a single HTML file using it as entry', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const fileDir = resolve(tmp, 'preview-file')
    mkdirSync(fileDir)
    const filePath = resolve(fileDir, 'main.html')
    writeFileSync(filePath, '<h1>main</h1>')

    const result = await executeJson('preview.publish', {
      sourcePath: filePath,
    }, { projectId: project.id, agentId: 'agent-test' })

    expect(result.previewId).toMatch(/^prev-/)
    const stored = previewStore.get(result.previewId)
    expect(stored?.entry_file).toBe('main.html')
    expect(stored?.source_path).toBe(fileDir)
    expect(result.title).toBe('preview-file')
  })

  test('rejects relative path', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const result = await executeRaw('preview.publish', { sourcePath: 'relative/path' }, { projectId: project.id, agentId: 'agent-test' })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error).toContain('绝对路径')
  })

  test('rejects non-existent path', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const result = await executeRaw('preview.publish', { sourcePath: resolve(tmp, 'nope') }, { projectId: project.id, agentId: 'agent-test' })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error).toContain('不存在')
  })

  test('rejects when entry file does not exist', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const previewDir = resolve(tmp, 'no-entry')
    mkdirSync(previewDir)
    const result = await executeRaw('preview.publish', {
      sourcePath: previewDir,
      entryFile: 'missing.html',
    }, { projectId: project.id, agentId: 'agent-test' })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error).toContain('入口文件')
  })

  test('respects explicit target=app', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const previewDir = resolve(tmp, 'preview-app')
    mkdirSync(previewDir)
    writeFileSync(resolve(previewDir, 'index.html'), '<h1>app</h1>')
    const result = await executeJson('preview.publish', {
      sourcePath: previewDir,
      target: 'app',
      taskId: 'task-app',
    }, { projectId: project.id, agentId: 'agent-test' })
    expect(result.target).toBe('app')
    expect(result.taskId).toBe('task-app')
  })

  test('output JSON has exact required shape', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const previewDir = resolve(tmp, 'preview-shape')
    mkdirSync(previewDir)
    writeFileSync(resolve(previewDir, 'index.html'), '<h1>shape</h1>')
    const result = await executeRaw('preview.publish', {
      sourcePath: previewDir,
    }, { projectId: project.id, agentId: 'agent-test' })
    const parsed = JSON.parse(result.content[0].text)
    expect(Object.keys(parsed).sort()).toEqual(['createdAt', 'previewId', 'target', 'taskId', 'title', 'url'].sort())
  })
})

async function executeRaw(
  handlerName: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolHandlerResult> {
  const handler = getHandler(handlerName)
  if (!handler) throw new Error(`handler missing: ${handlerName}`)
  return handler.execute(input, context)
}

async function executeJson(
  handlerName: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const result = await executeRaw(handlerName, input, context)
  expect(result.isError).not.toBe(true)
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}
