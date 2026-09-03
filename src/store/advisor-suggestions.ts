import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'

export type AdvisorSuggestionStatus = 'pending' | 'viewed' | 'accepted' | 'created' | 'ignored'
export type AdvisorSuggestionType = 'plan' | 'action'

export interface AdvisorArtifact {
  name: string
  relativePath: string
  size: number
}

export interface AdvisorSourceEvidence {
  sessionId: string
  title: string
}

export interface AdvisorSuggestionRow {
  id: string
  project_id: string
  round_id: string
  trigger_session_id: string | null
  sort_order: number
  type: AdvisorSuggestionType
  title: string
  description_markdown: string
  artifact_json: string | null
  source_evidence_json: string
  suggested_agent_id: string | null
  agent_reason: string
  status: AdvisorSuggestionStatus
  dispatch_token: string | null
  task_id: string | null
  execution_session_id: string | null
  created_at: string
  updated_at: string
  expire_at: string
}

export interface CreateAdvisorSuggestionInput {
  type: AdvisorSuggestionType
  title: string
  descriptionMarkdown: string
  suggestedAgentId?: string | null
  agentReason?: string
  sourceEvidence: AdvisorSourceEvidence[]
  artifact?: AdvisorArtifact | null
}

const EXPIRE_DAYS = 7

function computeExpireAt(now: string): string {
  return new Date(Date.parse(now) + EXPIRE_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

export const advisorSuggestionStore = {
  /** 同一轮幂等提交：事务内先清掉该轮旧建议再插入最新一批（S-3，轮间追加、轮内覆盖） */
  replaceRound(
    projectId: string,
    roundId: string,
    triggerSessionId: string | null,
    suggestions: CreateAdvisorSuggestionInput[],
    now = new Date().toISOString(),
  ): AdvisorSuggestionRow[] {
    const expireAt = computeExpireAt(now)
    const insert = getDb().prepare(`
      INSERT INTO advisor_suggestions (
        id, project_id, round_id, trigger_session_id, sort_order, type, title,
        description_markdown, artifact_json, source_evidence_json,
        suggested_agent_id, agent_reason, status, dispatch_token, task_id,
        execution_session_id, created_at, updated_at, expire_at
      ) VALUES (
        @id, @project_id, @round_id, @trigger_session_id, @sort_order, @type, @title,
        @description_markdown, @artifact_json, @source_evidence_json,
        @suggested_agent_id, @agent_reason, @status, @dispatch_token, @task_id,
        @execution_session_id, @created_at, @updated_at, @expire_at
      )
    `)
    const clearRound = getDb().prepare(
      'DELETE FROM advisor_suggestions WHERE project_id = ? AND round_id = ? AND status IN (?, ?)',
    )
    const rows = suggestions.map((suggestion, index): AdvisorSuggestionRow => ({
      id: `suggestion-${randomUUID().slice(0, 8)}`,
      project_id: projectId,
      round_id: roundId,
      trigger_session_id: triggerSessionId,
      sort_order: index,
      type: suggestion.type,
      title: suggestion.title,
      description_markdown: suggestion.descriptionMarkdown,
      artifact_json: suggestion.artifact ? JSON.stringify(suggestion.artifact) : null,
      source_evidence_json: JSON.stringify(suggestion.sourceEvidence),
      suggested_agent_id: suggestion.suggestedAgentId ?? null,
      agent_reason: suggestion.agentReason ?? '',
      status: 'pending',
      dispatch_token: null,
      task_id: null,
      execution_session_id: null,
      created_at: now,
      updated_at: now,
      expire_at: expireAt,
    }))
    getDb().transaction(() => {
      clearRound.run(projectId, roundId, 'pending', 'viewed')
      for (const row of rows) insert.run(row)
    })()
    return rows
  },

  get(id: string): AdvisorSuggestionRow | undefined {
    return getDb().prepare<[string], AdvisorSuggestionRow>(
      'SELECT * FROM advisor_suggestions WHERE id = ?',
    ).get(id)
  },

  /** 该轮是否已产卡（S-8 结算判定用，roundId 全局唯一） */
  hasRound(roundId: string): boolean {
    return !!getDb().prepare('SELECT 1 FROM advisor_suggestions WHERE round_id = ? LIMIT 1').get(roundId)
  },

  /** 未处理建议：pending/viewed 且未过期，新的在前（U-2 徽标来源 / L-6） */
  listActive(projectId: string, now = new Date().toISOString()): AdvisorSuggestionRow[] {
    return getDb().prepare<[string, string], AdvisorSuggestionRow>(`
      SELECT * FROM advisor_suggestions
      WHERE project_id = ? AND status IN ('pending', 'viewed') AND expire_at > ?
      ORDER BY created_at DESC, sort_order ASC, id ASC
    `).all(projectId, now)
  },

  /** 近期终态建议（沉底区展示），updated_at 近 48 小时（L-5/L-6） */
  listSettled(projectId: string, now = new Date().toISOString()): AdvisorSuggestionRow[] {
    const since = new Date(Date.parse(now) - 48 * 60 * 60 * 1000).toISOString()
    return getDb().prepare<[string, string], AdvisorSuggestionRow>(`
      SELECT * FROM advisor_suggestions
      WHERE project_id = ? AND status IN ('accepted', 'created', 'ignored') AND updated_at > ?
      ORDER BY updated_at DESC, id ASC
    `).all(projectId, since)
  },

  /** 已过期但仍是 pending 的建议（前端沉底展示、不计徽标，L-6）——只回过期未满 24h 的，隔天彻底消失 */
  listExpiredPending(projectId: string, now = new Date().toISOString()): AdvisorSuggestionRow[] {
    const windowStart = new Date(Date.parse(now) - 24 * 60 * 60 * 1000).toISOString()
    return getDb().prepare<[string, string, string], AdvisorSuggestionRow>(`
      SELECT * FROM advisor_suggestions
      WHERE project_id = ? AND status IN ('pending', 'viewed') AND expire_at <= ? AND expire_at > ?
      ORDER BY created_at DESC, id ASC
    `).all(projectId, now, windowStart)
  },

  /**
   * 惰性物理清理：删除「过期超 24h 且仍未处理」的建议行，返回被删行（含产物信息，供 core 层删孤儿 HTML）。
   * 终态（accepted/created/ignored）永久保留：任务侧产物链接仍引用其 HTML，属台账。
   */
  purgeExpiredUnprocessed(now = new Date().toISOString()): AdvisorSuggestionRow[] {
    const cutoff = new Date(Date.parse(now) - 24 * 60 * 60 * 1000).toISOString()
    const rows = getDb().prepare(`
      SELECT * FROM advisor_suggestions
      WHERE status IN ('pending', 'viewed') AND expire_at < ?
    `).all(cutoff) as AdvisorSuggestionRow[]
    if (rows.length === 0) return []
    const del = getDb().prepare(
      `DELETE FROM advisor_suggestions WHERE id = ? AND status IN ('pending', 'viewed')`,
    )
    getDb().transaction(() => {
      for (const row of rows) del.run(row.id)
    })()
    return rows
  },

  countPending(projectId: string, now = new Date().toISOString()): number {
    return getDb().prepare<[string, string], { count: number }>(`
      SELECT COUNT(*) AS count FROM advisor_suggestions
      WHERE project_id = ? AND status = 'pending' AND expire_at > ?
    `).get(projectId, now)?.count ?? 0
  },

  /** 打开建议 tab 批量已读：pending → viewed（L-2/U-2） */
  markViewed(projectId: string, ids: string[] | null, now = new Date().toISOString()): number {
    if (ids && ids.length === 0) return 0
    const placeholder = ids && ids.length > 0
      ? `AND id IN (${ids.map(() => '?').join(',')})`
      : ''
    const result = getDb().prepare(
      `UPDATE advisor_suggestions SET status = 'viewed', updated_at = ?
       WHERE project_id = ? AND status = 'pending' ${placeholder}`,
    ).run(...(ids && ids.length > 0 ? [now, projectId, ...ids] : [now, projectId]))
    return result.changes
  },

  ignore(id: string, now = new Date().toISOString()): AdvisorSuggestionRow | undefined {
    const result = getDb().prepare(`
      UPDATE advisor_suggestions SET status = 'ignored', dispatch_token = NULL, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'viewed') AND task_id IS NULL
    `).run(now, id)
    return result.changes === 1 ? this.get(id) : undefined
  },

  /** 派发令牌：原子占用，防止双击/并发重复建任务（L-7） */
  claimDispatch(id: string, token: string, now = new Date().toISOString()): AdvisorSuggestionRow | undefined {
    const result = getDb().prepare(`
      UPDATE advisor_suggestions SET dispatch_token = ?, updated_at = ?
      WHERE id = ? AND task_id IS NULL AND dispatch_token IS NULL AND status IN ('pending', 'viewed')
    `).run(token, now, id)
    return result.changes === 1 ? this.get(id) : undefined
  },

  completeDispatch(
    id: string,
    token: string,
    taskId: string,
    executionSessionId: string | null,
    finalStatus: 'accepted' | 'created',
    now = new Date().toISOString(),
  ): AdvisorSuggestionRow | undefined {
    getDb().prepare(`
      UPDATE advisor_suggestions
      SET task_id = ?, execution_session_id = ?, dispatch_token = NULL, status = ?, updated_at = ?
      WHERE id = ? AND dispatch_token = ?
    `).run(taskId, executionSessionId, finalStatus, now, id, token)
    return this.get(id)
  },

  releaseDispatch(id: string, token: string, now = new Date().toISOString()): void {
    getDb().prepare(`
      UPDATE advisor_suggestions SET dispatch_token = NULL, updated_at = ?
      WHERE id = ? AND dispatch_token = ? AND task_id IS NULL
    `).run(now, id, token)
  },

  releaseStaleDispatches(now = new Date().toISOString()): number {
    return getDb().prepare(`
      UPDATE advisor_suggestions SET dispatch_token = NULL, updated_at = ?
      WHERE dispatch_token IS NOT NULL AND task_id IS NULL
    `).run(now).changes
  },

  /** plan 建议产物落盘后回写台账（只存路径与 previewId，不存 HTML 内容，A-4） */
  persistArtifact(id: string, artifact: { fileName: string; size: number }, previewId: string, now = new Date().toISOString()): AdvisorSuggestionRow | undefined {
    const row = this.get(id)
    if (!row) return undefined
    const payload: AdvisorArtifact = { name: artifact.fileName, relativePath: `advisor-artifacts/${row.project_id}`, size: artifact.size }
    getDb().prepare(`
      UPDATE advisor_suggestions SET artifact_json = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify({ ...payload, previewId }), now, id)
    return this.get(id)
  },

  listAllByProject(projectId: string): AdvisorSuggestionRow[] {
    return getDb().prepare<[string], AdvisorSuggestionRow>(`
      SELECT * FROM advisor_suggestions WHERE project_id = ?
      ORDER BY created_at DESC, id ASC
    `).all(projectId)
  },
}
