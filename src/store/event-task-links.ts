import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export interface EventTaskLinkRow {
  id: string
  event_id: string
  task_id: string
  created_at: string
}

export const eventTaskLinkStore = {
  create(eventId: string, taskId: string): EventTaskLinkRow {
    const link: EventTaskLinkRow = {
      id: `etask-${randomUUID().slice(0, 8)}`,
      event_id: eventId,
      task_id: taskId,
      created_at: new Date().toISOString(),
    }
    getDb().prepare(`
      INSERT OR IGNORE INTO event_task_links (id, event_id, task_id, created_at)
      VALUES (@id, @event_id, @task_id, @created_at)
    `).run(link)
    return eventTaskLinkStore.listByEvent(eventId).find((row) => row.task_id === taskId) ?? link
  },

  listByEvent(eventId: string): EventTaskLinkRow[] {
    return getDb()
      .prepare<[string], EventTaskLinkRow>('SELECT * FROM event_task_links WHERE event_id = ? ORDER BY created_at ASC')
      .all(eventId)
  },
}
