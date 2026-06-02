import { randomUUID } from 'crypto'
import { getDb } from './db.js'
import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('store:model-profile')

export type ModelProfileRuntime = 'claude' | 'codex'

export interface ClaudeModelProfileConfig {
  defaultModel: string
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
}

export interface CodexModelProfileConfig {
  model: string
  effort?: string
}

export type ModelProfileConfig = ClaudeModelProfileConfig | CodexModelProfileConfig

export interface ModelProfileRow {
  id: string
  name: string
  runtime: string
  provider_id: string
  config_json: string
  context_window: number | null
  enabled: number
  created_at: string
  updated_at: string
}

export interface CreateModelProfileInput {
  name: string
  runtime: ModelProfileRuntime
  providerId: string
  config: ModelProfileConfig
  contextWindow?: number | null
  enabled?: boolean
}

export interface UpdateModelProfileInput {
  name?: string
  runtime?: ModelProfileRuntime
  providerId?: string
  config?: ModelProfileConfig
  contextWindow?: number | null
  enabled?: boolean
}

export interface ListModelProfileInput {
  runtime?: ModelProfileRuntime
  enabledOnly?: boolean
}

interface AgentConfigReferenceRow {
  id: string
  runtime: string
  config_json: string | null
}

export const modelProfileStore = {
  create(input: CreateModelProfileInput): ModelProfileRow {
    const now = new Date().toISOString()
    const row: ModelProfileRow = {
      id: `mpf-${randomUUID().slice(0, 8)}`,
      name: input.name,
      runtime: input.runtime,
      provider_id: input.providerId,
      config_json: JSON.stringify(input.config),
      context_window: input.contextWindow ?? null,
      enabled: input.enabled === false ? 0 : 1,
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO model_profiles (id, name, runtime, provider_id, config_json, context_window, enabled, created_at, updated_at)
      VALUES (@id, @name, @runtime, @provider_id, @config_json, @context_window, @enabled, @created_at, @updated_at)
    `).run(row)
    log.info({ profileId: row.id, runtime: row.runtime, providerId: row.provider_id }, '模型档案已创建')
    return row
  },

  get(id: string): ModelProfileRow | undefined {
    return getDb().prepare<[string], ModelProfileRow>('SELECT * FROM model_profiles WHERE id = ?').get(id)
  },

  list(input: ListModelProfileInput = {}): ModelProfileRow[] {
    const clauses: string[] = []
    const params: unknown[] = []
    if (input.runtime) {
      clauses.push('runtime = ?')
      params.push(input.runtime)
    }
    if (input.enabledOnly) clauses.push('enabled = 1')
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    return getDb().prepare<unknown[], ModelProfileRow>(`
      SELECT * FROM model_profiles ${where}
      ORDER BY runtime ASC, name ASC
    `).all(...params)
  },

  update(id: string, fields: UpdateModelProfileInput): ModelProfileRow | undefined {
    const existing = modelProfileStore.get(id)
    if (!existing) return undefined
    const updated: ModelProfileRow = {
      ...existing,
      name: fields.name ?? existing.name,
      runtime: fields.runtime ?? existing.runtime,
      provider_id: fields.providerId ?? existing.provider_id,
      config_json: fields.config !== undefined ? JSON.stringify(fields.config) : existing.config_json,
      context_window: fields.contextWindow !== undefined ? fields.contextWindow : existing.context_window,
      enabled: fields.enabled !== undefined ? (fields.enabled ? 1 : 0) : existing.enabled,
      updated_at: new Date().toISOString(),
    }
    getDb().prepare(`
      UPDATE model_profiles
      SET name=@name, runtime=@runtime, provider_id=@provider_id, config_json=@config_json,
          context_window=@context_window, enabled=@enabled, updated_at=@updated_at
      WHERE id=@id
    `).run(updated)
    if (fields.runtime !== undefined && fields.runtime !== existing.runtime) {
      unbindAgentsFromProfile(id, { allowedRuntime: updated.runtime })
    }
    log.info({ profileId: id, runtime: updated.runtime, providerId: updated.provider_id }, '模型档案已更新')
    return updated
  },

  toggle(id: string, enabled: boolean): void {
    getDb().prepare('UPDATE model_profiles SET enabled=?, updated_at=? WHERE id=?').run(
      enabled ? 1 : 0,
      new Date().toISOString(),
      id,
    )
    log.info({ profileId: id, enabled }, '模型档案启用状态已更新')
  },

  delete(id: string): void {
    unbindAgentsFromProfile(id)
    getDb().prepare('DELETE FROM model_profiles WHERE id = ?').run(id)
    log.info({ profileId: id }, '模型档案已删除')
  },
}

function unbindAgentsFromProfile(profileId: string, options: { allowedRuntime?: string } = {}): void {
  const db = getDb()
  const rows = db.prepare<[], AgentConfigReferenceRow>(
    'SELECT id, runtime, config_json FROM agents WHERE config_json IS NOT NULL',
  ).all()
  const updateAgent = db.prepare('UPDATE agents SET config_json = ? WHERE id = ?')
  for (const row of rows) {
    if (options.allowedRuntime && row.runtime === options.allowedRuntime) continue
    const config = parseConfig(row.config_json)
    if (config.modelProfileId !== profileId) continue
    delete config.modelProfileId
    const nextConfig = Object.keys(config).length > 0 ? JSON.stringify(config) : null
    updateAgent.run(nextConfig, row.id)
    log.debug({ profileId, agentId: row.id }, '已清理 Agent 模型档案绑定')
  }
}

function parseConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
