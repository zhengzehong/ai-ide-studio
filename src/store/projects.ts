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
}

export interface CreateProjectInput {
  name: string
  workDir: string
  description?: string
}

export const projectStore = {
  create(input: CreateProjectInput): ProjectRow {
    const now = new Date().toISOString()
    const project: ProjectRow = {
      id: `proj-${randomUUID().slice(0, 8)}`,
      name: input.name,
      work_dir: input.workDir,
      description: input.description ?? null,
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO projects (id, name, work_dir, description, created_at, updated_at)
      VALUES (@id, @name, @work_dir, @description, @created_at, @updated_at)
    `).run(project)
    log.info({ projectId: project.id, name: project.name, workDir: project.work_dir }, '项目已创建')
    return project
  },

  get(id: string): ProjectRow | undefined {
    return getDb().prepare<[string], ProjectRow>('SELECT * FROM projects WHERE id = ?').get(id)
  },

  list(): ProjectRow[] {
    return getDb().prepare<[], ProjectRow>('SELECT * FROM projects ORDER BY updated_at DESC').all()
  },

  update(id: string, fields: Partial<Pick<ProjectRow, 'name' | 'work_dir' | 'description'>>): ProjectRow | undefined {
    const project = projectStore.get(id)
    if (!project) return undefined

    const updated = { ...project, ...fields, updated_at: new Date().toISOString() }
    getDb().prepare(`
      UPDATE projects SET name = @name, work_dir = @work_dir, description = @description, updated_at = @updated_at
      WHERE id = @id
    `).run(updated)
    return updated
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(id)
    log.info({ projectId: id }, '项目已删除')
  },
}
