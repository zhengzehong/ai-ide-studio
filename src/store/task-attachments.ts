import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export interface TaskAttachmentRow {
  id: string
  task_id: string
  name: string | null
  mime_type: string
  relative_path: string
  absolute_path: string
  url: string
  size: number
  sort_order: number
  created_at: string
}

export const taskAttachmentStore = {
  replace(
    taskId: string,
    attachments: Array<{
      name?: string
      mimeType: string
      relativePath: string
      path: string
      url: string
      size: number
      order: number
    }>,
  ): TaskAttachmentRow[] {
    const db = getDb()
    const now = new Date().toISOString()
    const rows: TaskAttachmentRow[] = attachments.map((attachment) => ({
      id: `tatt-${randomUUID().slice(0, 8)}`,
      task_id: taskId,
      name: attachment.name ?? null,
      mime_type: attachment.mimeType,
      relative_path: attachment.relativePath,
      absolute_path: attachment.path,
      url: attachment.url,
      size: attachment.size,
      sort_order: attachment.order,
      created_at: now,
    }))
    const apply = db.transaction(() => {
      db.prepare('DELETE FROM task_attachments WHERE task_id = ?').run(taskId)
      const insert = db.prepare(`
        INSERT INTO task_attachments (
          id, task_id, name, mime_type, relative_path, absolute_path, url,
          size, sort_order, created_at
        )
        VALUES (
          @id, @task_id, @name, @mime_type, @relative_path, @absolute_path, @url,
          @size, @sort_order, @created_at
        )
      `)
      for (const row of rows) insert.run(row)
    })
    apply()
    return rows
  },

  list(taskId: string): TaskAttachmentRow[] {
    return getDb()
      .prepare<[string], TaskAttachmentRow>('SELECT * FROM task_attachments WHERE task_id = ? ORDER BY sort_order ASC')
      .all(taskId)
  },
}
