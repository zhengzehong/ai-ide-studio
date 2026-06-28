import { randomUUID } from 'crypto'
import { getDb } from './db.js'
import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('store:task-execution-modes')

export interface TaskExecutionModeRow {
  id: string
  name: string
  description: string | null
  prompt_template: string
  report_template: string
  is_builtin: number
  project_id: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface CreateTaskExecutionModeInput {
  id?: string
  name: string
  description?: string | null
  promptTemplate?: string
  reportTemplate?: string
  isBuiltin?: boolean
  projectId?: string | null
  sortOrder?: number
}

export interface UpdateTaskExecutionModeInput {
  name?: string
  description?: string | null
  promptTemplate?: string
  reportTemplate?: string
  sortOrder?: number
}

export const taskExecutionModeStore = {
  create(input: CreateTaskExecutionModeInput): TaskExecutionModeRow {
    const now = new Date().toISOString()
    const mode: TaskExecutionModeRow = {
      id: input.id ?? `temode-${randomUUID().slice(0, 8)}`,
      name: input.name,
      description: input.description ?? null,
      prompt_template: input.promptTemplate ?? '',
      report_template: input.reportTemplate ?? '',
      is_builtin: input.isBuiltin ? 1 : 0,
      project_id: input.projectId ?? null,
      sort_order: input.sortOrder ?? 0,
      created_at: now,
      updated_at: now,
    }
    getDb()
      .prepare(
        `
      INSERT INTO task_execution_modes (
        id, name, description, prompt_template, report_template,
        is_builtin, project_id, sort_order, created_at, updated_at
      )
      VALUES (
        @id, @name, @description, @prompt_template, @report_template,
        @is_builtin, @project_id, @sort_order, @created_at, @updated_at
      )
    `,
      )
      .run(mode)
    log.info({ modeId: mode.id, name: mode.name, projectId: mode.project_id }, '执行模式已创建')
    return mode
  },

  get(id: string): TaskExecutionModeRow | undefined {
    return getDb().prepare<[string], TaskExecutionModeRow>('SELECT * FROM task_execution_modes WHERE id = ?').get(id)
  },

  list(projectId?: string | null): TaskExecutionModeRow[] {
    return getDb()
      .prepare<[string | null], TaskExecutionModeRow>(
        `
      SELECT * FROM task_execution_modes
      WHERE project_id IS NULL OR project_id = ?
      ORDER BY is_builtin DESC, sort_order ASC, created_at ASC
    `,
      )
      .all(projectId ?? null)
  },

  listAll(): TaskExecutionModeRow[] {
    return getDb()
      .prepare<[], TaskExecutionModeRow>('SELECT * FROM task_execution_modes ORDER BY is_builtin DESC, sort_order ASC, created_at ASC')
      .all()
  },

  update(id: string, fields: UpdateTaskExecutionModeInput): TaskExecutionModeRow | undefined {
    const existing = taskExecutionModeStore.get(id)
    if (!existing) return undefined
    const updated: TaskExecutionModeRow = {
      ...existing,
      name: fields.name ?? existing.name,
      description: fields.description !== undefined ? fields.description : existing.description,
      prompt_template: fields.promptTemplate ?? existing.prompt_template,
      report_template: fields.reportTemplate ?? existing.report_template,
      sort_order: fields.sortOrder ?? existing.sort_order,
      updated_at: new Date().toISOString(),
    }
    getDb()
      .prepare(
        `
      UPDATE task_execution_modes
      SET name = @name,
          description = @description,
          prompt_template = @prompt_template,
          report_template = @report_template,
          sort_order = @sort_order,
          updated_at = @updated_at
      WHERE id = @id
    `,
      )
      .run(updated)
    return updated
  },

  delete(id: string): void {
    const existing = taskExecutionModeStore.get(id)
    if (!existing) return
    if (existing.is_builtin) {
      throw new Error('内置执行模式不可删除')
    }
    getDb().prepare('DELETE FROM task_execution_modes WHERE id = ?').run(id)
    log.info({ modeId: id }, '执行模式已删除')
  },
}
