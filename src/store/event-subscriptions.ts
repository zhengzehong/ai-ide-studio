import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export type EventConsumerSessionMode = 'existing' | 'new_each' | 'new_fixed'

export interface EventSubscriptionRow {
  id: string
  project_id: string | null
  name: string
  category_id: string
  consumer_agent_id: string | null
  consumer_label: string | null
  action_mode: string
  filter_json: string
  enabled: number
  auto_start: number
  consumer_session_mode: EventConsumerSessionMode
  consumer_session_id: string | null
  created_at: string
  updated_at: string
}

export interface CreateEventSubscriptionInput {
  projectId?: string | null
  name: string
  categoryId: string
  consumerAgentId?: string | null
  consumerLabel?: string | null
  actionMode?: string
  filter?: Record<string, unknown>
  enabled?: boolean
  autoStart?: boolean
  consumerSessionMode?: EventConsumerSessionMode
  consumerSessionId?: string | null
}

export type UpdateEventSubscriptionInput = CreateEventSubscriptionInput

export const eventSubscriptionStore = {
  create(input: CreateEventSubscriptionInput): EventSubscriptionRow {
    const now = new Date().toISOString()
    const subscription: EventSubscriptionRow = {
      id: `esub-${randomUUID().slice(0, 8)}`,
      project_id: input.projectId ?? null,
      name: input.name,
      category_id: input.categoryId,
      consumer_agent_id: input.consumerAgentId ?? null,
      consumer_label: input.consumerLabel ?? null,
      action_mode: input.actionMode ?? 'create_pending',
      filter_json: JSON.stringify(input.filter ?? {}),
      enabled: input.enabled === false ? 0 : 1,
      auto_start: input.autoStart ? 1 : 0,
      consumer_session_mode: input.consumerSessionMode ?? 'new_each',
      consumer_session_id: input.consumerSessionId ?? null,
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO event_subscriptions (
        id, project_id, name, category_id, consumer_agent_id, consumer_label,
        action_mode, filter_json, enabled, auto_start, consumer_session_mode,
        consumer_session_id, created_at, updated_at
      )
      VALUES (
        @id, @project_id, @name, @category_id, @consumer_agent_id, @consumer_label,
        @action_mode, @filter_json, @enabled, @auto_start, @consumer_session_mode,
        @consumer_session_id, @created_at, @updated_at
      )
    `).run(subscription)
    return subscription
  },

  get(id: string): EventSubscriptionRow | undefined {
    return getDb().prepare<[string], EventSubscriptionRow>('SELECT * FROM event_subscriptions WHERE id = ?').get(id)
  },

  list(projectId?: string): EventSubscriptionRow[] {
    if (projectId) {
      return getDb()
        .prepare<[string], EventSubscriptionRow>(`
          SELECT * FROM event_subscriptions
          WHERE project_id = ? OR project_id IS NULL
          ORDER BY created_at DESC
        `)
        .all(projectId)
    }
    return getDb().prepare<[], EventSubscriptionRow>('SELECT * FROM event_subscriptions ORDER BY created_at DESC').all()
  },

  listMatching(categoryId: string, projectId?: string | null): EventSubscriptionRow[] {
    if (projectId) {
      return getDb()
        .prepare<[string, string], EventSubscriptionRow>(`
          SELECT * FROM event_subscriptions
          WHERE category_id = ? AND enabled = 1 AND (project_id = ? OR project_id IS NULL)
          ORDER BY created_at ASC
        `)
        .all(categoryId, projectId)
    }
    return getDb()
      .prepare<[string], EventSubscriptionRow>(`
        SELECT * FROM event_subscriptions
        WHERE category_id = ? AND enabled = 1 AND project_id IS NULL
        ORDER BY created_at ASC
      `)
      .all(categoryId)
  },

  toggle(id: string, enabled: boolean): EventSubscriptionRow | undefined {
    getDb().prepare('UPDATE event_subscriptions SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, new Date().toISOString(), id)
    return eventSubscriptionStore.get(id)
  },

  update(id: string, input: UpdateEventSubscriptionInput): EventSubscriptionRow | undefined {
    getDb().prepare(`
      UPDATE event_subscriptions
      SET
        project_id = ?,
        name = ?,
        category_id = ?,
        consumer_agent_id = ?,
        consumer_label = ?,
        action_mode = ?,
        filter_json = ?,
        enabled = ?,
        auto_start = ?,
        consumer_session_mode = ?,
        consumer_session_id = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      input.projectId ?? null,
      input.name,
      input.categoryId,
      input.consumerAgentId ?? null,
      input.consumerLabel ?? null,
      input.actionMode ?? 'create_pending',
      JSON.stringify(input.filter ?? {}),
      input.enabled === false ? 0 : 1,
      input.autoStart ? 1 : 0,
      input.consumerSessionMode ?? 'new_each',
      input.consumerSessionId ?? null,
      new Date().toISOString(),
      id,
    )
    return eventSubscriptionStore.get(id)
  },

  remove(id: string): boolean {
    const result = getDb().prepare('DELETE FROM event_subscriptions WHERE id = ?').run(id)
    return result.changes > 0
  },

  setConsumerSession(id: string, sessionId: string | null): EventSubscriptionRow | undefined {
    getDb().prepare('UPDATE event_subscriptions SET consumer_session_id = ?, updated_at = ? WHERE id = ?')
      .run(sessionId, new Date().toISOString(), id)
    return eventSubscriptionStore.get(id)
  },
}
