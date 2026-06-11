import { getDb } from './db.js'

export interface EventCategoryRow {
  id: string
  name: string
  description: string | null
  schema_json: string
  default_priority: string
  allowed_writers_json: string
  allowed_consumers_json: string
  enabled: number
  created_at: string
  updated_at: string
}

export interface UpsertEventCategoryInput {
  id: string
  name: string
  description?: string | null
  schema?: Record<string, unknown>
  defaultPriority?: string
  allowedWriters?: string[]
  allowedConsumers?: string[]
  enabled?: boolean
}

export interface EventCategoryReferenceCounts {
  events: number
  subscriptions: number
}

export const eventCategoryStore = {
  list(): EventCategoryRow[] {
    return getDb().prepare<[], EventCategoryRow>('SELECT * FROM event_categories ORDER BY id ASC').all()
  },

  get(id: string): EventCategoryRow | undefined {
    return getDb().prepare<[string], EventCategoryRow>('SELECT * FROM event_categories WHERE id = ?').get(id)
  },

  upsert(input: UpsertEventCategoryInput): EventCategoryRow {
    const now = new Date().toISOString()
    const existing = eventCategoryStore.get(input.id)
    const category: EventCategoryRow = {
      id: input.id,
      name: input.name,
      description: input.description ?? null,
      schema_json: JSON.stringify(input.schema ?? {}),
      default_priority: input.defaultPriority ?? 'medium',
      allowed_writers_json: JSON.stringify(input.allowedWriters ?? ['*']),
      allowed_consumers_json: JSON.stringify(input.allowedConsumers ?? ['*']),
      enabled: input.enabled === false ? 0 : 1,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    }

    getDb().prepare(`
      INSERT INTO event_categories (
        id, name, description, schema_json, default_priority,
        allowed_writers_json, allowed_consumers_json, enabled, created_at, updated_at
      )
      VALUES (
        @id, @name, @description, @schema_json, @default_priority,
        @allowed_writers_json, @allowed_consumers_json, @enabled, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        schema_json = excluded.schema_json,
        default_priority = excluded.default_priority,
        allowed_writers_json = excluded.allowed_writers_json,
        allowed_consumers_json = excluded.allowed_consumers_json,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `).run(category)

    return eventCategoryStore.get(input.id)!
  },

  toggle(id: string, enabled: boolean): EventCategoryRow | undefined {
    getDb().prepare('UPDATE event_categories SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, new Date().toISOString(), id)
    return eventCategoryStore.get(id)
  },

  referenceCounts(id: string): EventCategoryReferenceCounts {
    const events = getDb()
      .prepare<[string], { count: number }>('SELECT COUNT(*) AS count FROM event_center_events WHERE category_id = ?')
      .get(id)?.count ?? 0
    const subscriptions = getDb()
      .prepare<[string], { count: number }>('SELECT COUNT(*) AS count FROM event_subscriptions WHERE category_id = ?')
      .get(id)?.count ?? 0
    return { events, subscriptions }
  },

  remove(id: string): boolean {
    const result = getDb().prepare('DELETE FROM event_categories WHERE id = ?').run(id)
    return result.changes > 0
  },
}
