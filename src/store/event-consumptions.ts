import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export interface EventConsumptionRow {
  id: string
  event_id: string
  subscription_id: string | null
  project_id: string | null
  consumer_agent_id: string | null
  consumer_label: string | null
  status: string
  result_summary: string | null
  result_json: string | null
  error: string | null
  session_id: string | null
  claimed_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface CreateEventConsumptionInput {
  eventId: string
  subscriptionId?: string | null
  projectId?: string | null
  consumerAgentId?: string | null
  consumerLabel?: string | null
  sessionId?: string | null
  status?: string
}

export const eventConsumptionStore = {
  create(input: CreateEventConsumptionInput): EventConsumptionRow {
    const now = new Date().toISOString()
    const row: EventConsumptionRow = {
      id: `econs-${randomUUID().slice(0, 8)}`,
      event_id: input.eventId,
      subscription_id: input.subscriptionId ?? null,
      project_id: input.projectId ?? null,
      consumer_agent_id: input.consumerAgentId ?? null,
      consumer_label: input.consumerLabel ?? null,
      status: input.status ?? 'pending',
      result_summary: null,
      result_json: null,
      error: null,
      session_id: input.sessionId ?? null,
      claimed_at: null,
      completed_at: null,
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT OR IGNORE INTO event_consumptions (
        id, event_id, subscription_id, project_id, consumer_agent_id, consumer_label,
        status, result_summary, result_json, error, session_id, claimed_at, completed_at,
        created_at, updated_at
      )
      VALUES (
        @id, @event_id, @subscription_id, @project_id, @consumer_agent_id, @consumer_label,
        @status, @result_summary, @result_json, @error, @session_id, @claimed_at,
        @completed_at, @created_at, @updated_at
      )
    `).run(row)
    return eventConsumptionStore.findExisting(input) ?? row
  },

  get(id: string): EventConsumptionRow | undefined {
    return getDb().prepare<[string], EventConsumptionRow>('SELECT * FROM event_consumptions WHERE id = ?').get(id)
  },

  findExisting(input: CreateEventConsumptionInput): EventConsumptionRow | undefined {
    return getDb()
      .prepare<[string, string | null, string | null], EventConsumptionRow>(`
        SELECT * FROM event_consumptions
        WHERE event_id = ?
          AND subscription_id IS ?
          AND consumer_agent_id IS ?
        LIMIT 1
      `)
      .get(input.eventId, input.subscriptionId ?? null, input.consumerAgentId ?? null)
  },

  listByEvent(eventId: string): EventConsumptionRow[] {
    return getDb()
      .prepare<[string], EventConsumptionRow>('SELECT * FROM event_consumptions WHERE event_id = ? ORDER BY created_at ASC')
      .all(eventId)
  },

  listPendingForAgent(input: { projectId?: string; agentId: string }): EventConsumptionRow[] {
    const db = getDb()
    return input.projectId
      ? db.prepare<[string, string], EventConsumptionRow>(`
          SELECT * FROM event_consumptions
          WHERE status = 'pending' AND consumer_agent_id = ? AND project_id = ?
          ORDER BY created_at ASC
        `).all(input.agentId, input.projectId)
      : db.prepare<[string], EventConsumptionRow>(`
          SELECT * FROM event_consumptions
          WHERE status = 'pending' AND consumer_agent_id = ?
          ORDER BY created_at ASC
        `).all(input.agentId)
  },

  claimNext(input: { projectId?: string; agentId: string }): EventConsumptionRow | undefined {
    const row = eventConsumptionStore.listPendingForAgent(input)[0]
    if (!row) return undefined
    return eventConsumptionStore.claim(row.id)
  },

  claim(id: string): EventConsumptionRow {
    const now = new Date().toISOString()
    getDb().prepare(`
      UPDATE event_consumptions
      SET status = 'running', claimed_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(now, now, id)
    const updated = eventConsumptionStore.get(id)
    if (!updated) throw new Error(`消费记录不存在: ${id}`)
    return updated
  },

  setSession(id: string, sessionId: string): EventConsumptionRow {
    getDb().prepare('UPDATE event_consumptions SET session_id = ?, updated_at = ? WHERE id = ?')
      .run(sessionId, new Date().toISOString(), id)
    const updated = eventConsumptionStore.get(id)
    if (!updated) throw new Error(`娑堣垂璁板綍涓嶅瓨鍦? ${id}`)
    return updated
  },

  complete(id: string, input: { resultSummary?: string; result?: Record<string, unknown>; error?: string }): EventConsumptionRow {
    const status = input.error ? 'failed' : 'succeeded'
    const now = new Date().toISOString()
    getDb().prepare(`
      UPDATE event_consumptions
      SET status = ?, result_summary = ?, result_json = ?, error = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      status,
      input.resultSummary ?? null,
      input.result ? JSON.stringify(input.result) : null,
      input.error ?? null,
      now,
      now,
      id,
    )
    const updated = eventConsumptionStore.get(id)
    if (!updated) throw new Error(`消费记录不存在: ${id}`)
    return updated
  },
}
