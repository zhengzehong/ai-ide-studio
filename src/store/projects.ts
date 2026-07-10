import { randomUUID } from 'crypto'
import { getDb } from './db.js'
import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('store:project')

export interface ProjectRow {
  id: string
  name: string
  work_dir: string
  description: string | null
  created_at: string
  updated_at: string
  color: string | null
  icon: string | null
  last_visited_at: string | null
  visit_count: number
}

export interface CreateProjectInput {
  name: string
  workDir?: string
  description?: string
  color?: string
  icon?: string
}

export const projectStore = {
  create(input: CreateProjectInput): ProjectRow {
    const now = new Date().toISOString()
    const project: ProjectRow = {
      id: `proj-${randomUUID().slice(0, 8)}`,
      name: input.name,
      work_dir: input.workDir ?? '',
      description: input.description ?? null,
      created_at: now,
      updated_at: now,
      color: input.color ?? null,
      icon: input.icon ?? null,
      last_visited_at: null,
      visit_count: 0,
    }
    getDb().prepare(`
      INSERT INTO projects (id, name, work_dir, description, created_at, updated_at, color, icon, last_visited_at, visit_count)
      VALUES (@id, @name, @work_dir, @description, @created_at, @updated_at, @color, @icon, @last_visited_at, @visit_count)
    `).run(project)
    log.info({ projectId: project.id, name: project.name, workDir: project.work_dir }, '项目已创建')
    return project
  },

  get(id: string): ProjectRow | undefined {
    return getDb().prepare<[string], ProjectRow>('SELECT * FROM projects WHERE id = ?').get(id)
  },

  list(): ProjectRow[] {
    return getDb()
      .prepare<[], ProjectRow>(
        `SELECT * FROM projects ORDER BY (last_visited_at IS NULL) ASC, last_visited_at DESC, created_at DESC`,
      )
      .all()
  },

  update(
    id: string,
    fields: Partial<Pick<ProjectRow, 'name' | 'work_dir' | 'description' | 'color' | 'icon'>>,
  ): ProjectRow | undefined {
    const project = projectStore.get(id)
    if (!project) return undefined

    const updated = { ...project, ...fields, updated_at: new Date().toISOString() }
    getDb().prepare(`
      UPDATE projects SET name = @name, work_dir = @work_dir, description = @description, color = @color, icon = @icon, updated_at = @updated_at
      WHERE id = @id
    `).run(updated)
    return updated
  },

  touchVisit(id: string): ProjectRow | undefined {
    const project = projectStore.get(id)
    if (!project) return undefined
    const now = new Date().toISOString()
    const updated = {
      ...project,
      last_visited_at: now,
      visit_count: project.visit_count + 1,
      updated_at: project.updated_at,
    }
    getDb()
      .prepare(
        `UPDATE projects SET last_visited_at = @last_visited_at, visit_count = @visit_count WHERE id = @id`,
      )
      .run(updated)
    return updated
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(id)
    log.info({ projectId: id }, '项目已删除')
  },
}
