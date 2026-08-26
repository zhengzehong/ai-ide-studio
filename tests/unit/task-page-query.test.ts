import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { listTaskPageReadModel } from '../../src/queries/task-list-query.js'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { taskStore, type TaskRow } from '../../src/store/tasks.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-task-page-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('paged task read model', () => {
  test('continues after the last task ID with deterministic ordering', () => {
    const project = projectStore.create({ name: 'Paged', workDir: tmp })
    const older = createAt(project.id, 'Older', '2026-08-24T10:00:00.000Z')
    const sameTimeA = createAt(project.id, 'Same A', '2026-08-25T10:00:00.000Z')
    const sameTimeB = createAt(project.id, 'Same B', '2026-08-25T10:00:00.000Z')
    const expectedSameTime = [sameTimeA, sameTimeB].sort((a, b) => b.id.localeCompare(a.id))

    const first = listTaskPageReadModel({ projectId: project.id, limit: 2 })

    expect(first.items.map((task) => task.id)).toEqual(expectedSameTime.map((task) => task.id))
    expect(first).toMatchObject({ total: 3, hasMore: true, nextCursor: expectedSameTime[1].id })

    const second = listTaskPageReadModel({ projectId: project.id, limit: 2, cursor: first.nextCursor ?? undefined })
    expect(second.items.map((task) => task.id)).toEqual([older.id])
    expect(second).toMatchObject({ total: 3, hasMore: false, nextCursor: null })
  })

  test('filters time scope, terminal tasks, search, and project in SQL', () => {
    const project = projectStore.create({ name: 'Paged', workDir: tmp })
    const other = projectStore.create({ name: 'Other', workDir: resolve(tmp, 'other') })
    const activeHistory = createAt(project.id, 'Rare migration task', '2026-08-24T10:00:00.000Z')
    createAt(project.id, 'Completed history', '2026-08-24T09:00:00.000Z', 'completed')
    createAt(project.id, 'Today task', '2026-08-26T02:00:00.000Z')
    createAt(other.id, 'Rare other project', '2026-08-24T08:00:00.000Z')

    const page = listTaskPageReadModel({
      projectId: project.id,
      createdBefore: '2026-08-26T00:00:00.000Z',
      excludeTerminal: true,
      query: 'rare migration',
      limit: 50,
    })

    expect(page.items.map((task) => task.id)).toEqual([activeHistory.id])
    expect(page.total).toBe(1)
  })

  test('rejects a cursor outside the current project', () => {
    const project = projectStore.create({ name: 'Paged', workDir: tmp })
    const other = projectStore.create({ name: 'Other', workDir: resolve(tmp, 'other') })
    createAt(project.id, 'Current project', '2026-08-25T10:00:00.000Z')
    const foreign = createAt(other.id, 'Other project', '2026-08-25T09:00:00.000Z')

    expect(() => listTaskPageReadModel({
      projectId: project.id,
      cursor: foreign.id,
      limit: 50,
    })).toThrow('Invalid task cursor')
  })

  test('rejects a cursor that does not match the active filters', () => {
    const project = projectStore.create({ name: 'Paged', workDir: tmp })
    const completed = createAt(project.id, 'Completed', '2026-08-25T09:00:00.000Z', 'completed')

    expect(() => listTaskPageReadModel({
      projectId: project.id,
      excludeTerminal: true,
      cursor: completed.id,
      limit: 50,
    })).toThrow('Invalid task cursor')
  })
})

function createAt(
  projectId: string,
  title: string,
  createdAt: string,
  status = 'running',
): TaskRow {
  const task = taskStore.create({ title, description: `${title} description`, projectId })
  getDb().prepare('UPDATE tasks SET created_at = ?, status = ? WHERE id = ?').run(createdAt, status, task.id)
  return { ...task, created_at: createdAt, status }
}
