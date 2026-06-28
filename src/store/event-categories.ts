import { getDb } from './db.js'

export const GLOBAL_EVENT_CATEGORY_SCOPE = '__global__'

export interface EventCategoryRow {
  id: string
  project_id: string | null
  scope_key: string
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
  projectId?: string | null
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
  list(projectId?: string | null): EventCategoryRow[] {
    const normalizedProjectId = normalizeProjectId(projectId)
    const globalRows = getDb()
      .prepare<[string], EventCategoryRow>('SELECT * FROM event_categories WHERE scope_key = ? ORDER BY id ASC')
      .all(GLOBAL_EVENT_CATEGORY_SCOPE)

    if (!normalizedProjectId) return globalRows

    const projectRows = getDb()
      .prepare<[string], EventCategoryRow>('SELECT * FROM event_categories WHERE scope_key = ? ORDER BY id ASC')
      .all(scopeKey(normalizedProjectId))
    const rowsById = new Map(globalRows.map((category) => [category.id, category]))
    for (const category of projectRows) rowsById.set(category.id, category)
    return [...rowsById.values()].sort((left, right) => left.id.localeCompare(right.id))
  },

  get(id: string, projectId?: string | null): EventCategoryRow | undefined {
    return getDb()
      .prepare<[string, string], EventCategoryRow>('SELECT * FROM event_categories WHERE scope_key = ? AND id = ?')
      .get(scopeKey(projectId), id)
  },

  resolve(id: string, projectId?: string | null): EventCategoryRow | undefined {
    const normalizedProjectId = normalizeProjectId(projectId)
    if (normalizedProjectId) {
      const projectCategory = eventCategoryStore.get(id, normalizedProjectId)
      if (projectCategory) return projectCategory
    }
    return eventCategoryStore.get(id)
  },

  upsert(input: UpsertEventCategoryInput): EventCategoryRow {
    const now = new Date().toISOString()
    const normalizedProjectId = normalizeProjectId(input.projectId)
    const scope = scopeKey(normalizedProjectId)
    const existing = eventCategoryStore.get(input.id, normalizedProjectId)
    const category: EventCategoryRow = {
      id: input.id,
      project_id: normalizedProjectId,
      scope_key: scope,
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
        id, project_id, scope_key, name, description, schema_json, default_priority,
        allowed_writers_json, allowed_consumers_json, enabled, created_at, updated_at
      )
      VALUES (
        @id, @project_id, @scope_key, @name, @description, @schema_json, @default_priority,
        @allowed_writers_json, @allowed_consumers_json, @enabled, @created_at, @updated_at
      )
      ON CONFLICT(scope_key, id) DO UPDATE SET
        project_id = excluded.project_id,
        name = excluded.name,
        description = excluded.description,
        schema_json = excluded.schema_json,
        default_priority = excluded.default_priority,
        allowed_writers_json = excluded.allowed_writers_json,
        allowed_consumers_json = excluded.allowed_consumers_json,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `).run(category)

    return eventCategoryStore.get(input.id, normalizedProjectId)!
  },

  toggle(id: string, enabled: boolean, projectId?: string | null): EventCategoryRow | undefined {
    const normalizedProjectId = normalizeProjectId(projectId)
    getDb()
      .prepare('UPDATE event_categories SET enabled = ?, updated_at = ? WHERE scope_key = ? AND id = ?')
      .run(enabled ? 1 : 0, new Date().toISOString(), scopeKey(normalizedProjectId), id)
    return eventCategoryStore.get(id, normalizedProjectId)
  },

  referenceCounts(id: string, projectId?: string | null): EventCategoryReferenceCounts {
    const normalizedProjectId = normalizeProjectId(projectId)
    if (normalizedProjectId) {
      const events = getDb()
        .prepare<[string, string], { count: number }>('SELECT COUNT(*) AS count FROM event_center_events WHERE category_id = ? AND project_id = ?')
        .get(id, normalizedProjectId)?.count ?? 0
      const subscriptions = getDb()
        .prepare<[string, string], { count: number }>('SELECT COUNT(*) AS count FROM event_subscriptions WHERE category_id = ? AND project_id = ?')
        .get(id, normalizedProjectId)?.count ?? 0
      return { events, subscriptions }
    }

    const events = getDb()
      .prepare<[string], { count: number }>('SELECT COUNT(*) AS count FROM event_center_events WHERE category_id = ?')
      .get(id)?.count ?? 0
    const subscriptions = getDb()
      .prepare<[string], { count: number }>('SELECT COUNT(*) AS count FROM event_subscriptions WHERE category_id = ?')
      .get(id)?.count ?? 0
    return { events, subscriptions }
  },

  remove(id: string, projectId?: string | null): boolean {
    const result = getDb().prepare('DELETE FROM event_categories WHERE scope_key = ? AND id = ?').run(scopeKey(projectId), id)
    return result.changes > 0
  },
}

export function scopeKey(projectId?: string | null): string {
  return normalizeProjectId(projectId) ?? GLOBAL_EVENT_CATEGORY_SCOPE
}

function normalizeProjectId(projectId?: string | null): string | null {
  return typeof projectId === 'string' && projectId.trim() ? projectId.trim() : null
}
