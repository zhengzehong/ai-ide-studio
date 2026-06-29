import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export interface PreviewRow {
  id: string
  project_id: string
  title: string
  source_path: string
  entry_file: string
  target: 'pc' | 'app'
  task_id: string | null
  description: string | null
  created_by_agent_id: string | null
  created_at: string
}

export interface CreatePreviewInput {
  projectId: string
  title: string
  sourcePath: string
  entryFile?: string
  target?: 'pc' | 'app'
  taskId?: string | null
  description?: string | null
  createdByAgentId?: string | null
}

export const previewStore = {
  create(input: CreatePreviewInput): PreviewRow {
    const now = new Date().toISOString()
    const row: PreviewRow = {
      id: `prev-${randomUUID().slice(0, 8)}`,
      project_id: input.projectId,
      title: input.title,
      source_path: input.sourcePath,
      entry_file: input.entryFile ?? 'index.html',
      target: input.target ?? 'pc',
      task_id: input.taskId ?? null,
      description: input.description ?? null,
      created_by_agent_id: input.createdByAgentId ?? null,
      created_at: now,
    }
    getDb().prepare(`
      INSERT INTO previews (
        id, project_id, title, source_path, entry_file, target,
        task_id, description, created_by_agent_id, created_at
      )
      VALUES (
        @id, @project_id, @title, @source_path, @entry_file, @target,
        @task_id, @description, @created_by_agent_id, @created_at
      )
    `).run(row)
    return row
  },

  get(id: string): PreviewRow | undefined {
    return getDb()
      .prepare<[string], PreviewRow>('SELECT * FROM previews WHERE id = ?')
      .get(id)
  },

  list(projectId?: string, taskId?: string): PreviewRow[] {
    if (projectId && taskId) {
      return getDb()
        .prepare<[string, string], PreviewRow>(
          'SELECT * FROM previews WHERE project_id = ? AND task_id = ? ORDER BY created_at DESC',
        )
        .all(projectId, taskId)
    }
    if (projectId) {
      return getDb()
        .prepare<[string], PreviewRow>(
          'SELECT * FROM previews WHERE project_id = ? ORDER BY created_at DESC',
        )
        .all(projectId)
    }
    if (taskId) {
      return getDb()
        .prepare<[string], PreviewRow>(
          'SELECT * FROM previews WHERE task_id = ? ORDER BY created_at DESC',
        )
        .all(taskId)
    }
    return getDb()
      .prepare<[], PreviewRow>('SELECT * FROM previews ORDER BY created_at DESC')
      .all()
  },

  listByTask(taskId: string): PreviewRow[] {
    return getDb()
      .prepare<[string], PreviewRow>(
        'SELECT * FROM previews WHERE task_id = ? ORDER BY created_at DESC',
      )
      .all(taskId)
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM previews WHERE id = ?').run(id)
  },
}
