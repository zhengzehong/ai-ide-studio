import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { studioTaskListHandler } from '../../src/tools/handlers/studio-task-crud-tools.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { taskStore } from '../../src/store/tasks.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-studio-task-list-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('studio.task.list', () => {
  test('returns at most 200 compact summaries by default', async () => {
    const project = projectStore.create({ name: 'Paged', workDir: tmp })
    for (let index = 0; index < 201; index += 1) {
      taskStore.create({
        title: `Task ${String(index).padStart(3, '0')}`,
        description: `private description ${index}`,
        projectId: project.id,
      })
    }

    const result = await executeList({ limit: 500 }, project.id)

    expect(result.tasks).toHaveLength(200)
    expect(result).toMatchObject({ total: 201, hasMore: true })
    expect(result.nextCursor).toEqual(result.tasks[199]?.id)
    expect(result.tasks[0]).toEqual({
      id: expect.any(String),
      title: expect.any(String),
      status: 'draft',
      stage: '',
      source: 'human',
      assignedAgentId: null,
      createdAt: expect.any(String),
    })
  })

  test('uses context project scope and supports query plus cursor', async () => {
    const project = projectStore.create({ name: 'Paged', workDir: tmp })
    const other = projectStore.create({ name: 'Other', workDir: resolve(tmp, 'other') })
    taskStore.create({ title: 'Common task', description: 'Common', projectId: project.id })
    const target = taskStore.create({ title: 'Rare migration task', description: 'Rare', projectId: project.id })
    taskStore.create({ title: 'Rare other task', description: 'Other', projectId: other.id })

    const searched = await executeList({ projectId: other.id, query: 'rare migration' }, project.id)
    expect(searched.tasks.map((task) => task.id)).toEqual([target.id])

    const first = await executeList({ limit: 1 }, project.id)
    const second = await executeList({ limit: 1, cursor: first.nextCursor }, project.id)
    expect(second.tasks).toHaveLength(1)
    expect(second.tasks[0]?.id).not.toBe(first.tasks[0]?.id)
  })

  test('does not accept a project scope supplied in tool input', async () => {
    const project = projectStore.create({ name: 'Paged', workDir: tmp })
    taskStore.create({ title: 'Hidden task', projectId: project.id })

    const result = await studioTaskListHandler.execute({ projectId: project.id })
    const text = result.content.find((item) => item.type === 'text')

    expect(text).toMatchObject({ type: 'text', text: JSON.stringify({ error: 'projectId 不能为空' }) })
    expect(result.isError).toBe(true)
  })
})

interface CompactTask {
  id: string
  title: string
  status: string
  stage: string
  source: string
  assignedAgentId: string | null
  createdAt: string
}

interface StudioTaskListResult {
  tasks: CompactTask[]
  total: number
  hasMore: boolean
  nextCursor: string | null
}

async function executeList(input: Record<string, unknown>, projectId: string): Promise<StudioTaskListResult> {
  const result = await studioTaskListHandler.execute(input, { projectId })
  const text = result.content.find((item) => item.type === 'text')
  if (!text || text.type !== 'text') throw new Error('Missing tool text result')
  return JSON.parse(text.text) as StudioTaskListResult
}
