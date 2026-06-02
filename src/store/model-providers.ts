import { randomUUID } from 'crypto'
import { getDb } from './db.js'
import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('store:model')

export type ModelProtocol = 'openai' | 'claude' | 'new-api'

export interface ModelEntry {
  id: string
  name: string
  isDefault?: boolean
}

export interface ModelProviderRow {
  id: string
  name: string
  display_name: string
  protocol: string
  base_url: string
  api_key: string
  models_json: string
  is_default: number
  enabled: number
  created_at: string
  updated_at: string
}

export interface CreateProviderInput {
  name: string
  displayName: string
  protocol: ModelProtocol
  baseUrl: string
  apiKey: string
  models?: ModelEntry[]
  isDefault?: boolean
}

export const modelProviderStore = {
  create(input: CreateProviderInput): ModelProviderRow {
    const now = new Date().toISOString()
    const row: ModelProviderRow = {
      id: `mp-${randomUUID().slice(0, 8)}`,
      name: input.name,
      display_name: input.displayName,
      protocol: input.protocol,
      base_url: input.baseUrl,
      api_key: input.apiKey,
      models_json: JSON.stringify(input.models ?? []),
      is_default: input.isDefault ? 1 : 0,
      enabled: 1,
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO model_providers (id, name, display_name, protocol, base_url, api_key, models_json, is_default, enabled, created_at, updated_at)
      VALUES (@id, @name, @display_name, @protocol, @base_url, @api_key, @models_json, @is_default, @enabled, @created_at, @updated_at)
    `).run(row)
    log.info({ providerId: row.id, name: row.name, protocol: row.protocol }, '模型供应商已创建')
    return row
  },

  get(id: string): ModelProviderRow | undefined {
    return getDb().prepare<[string], ModelProviderRow>('SELECT * FROM model_providers WHERE id = ?').get(id)
  },

  list(): ModelProviderRow[] {
    return getDb().prepare<[], ModelProviderRow>('SELECT * FROM model_providers ORDER BY is_default DESC, name').all()
  },

  update(id: string, fields: Partial<CreateProviderInput>): ModelProviderRow | undefined {
    const row = modelProviderStore.get(id)
    if (!row) return undefined

    const updated: ModelProviderRow = {
      ...row,
      display_name: fields.displayName ?? row.display_name,
      protocol: fields.protocol ?? row.protocol,
      base_url: fields.baseUrl ?? row.base_url,
      api_key: fields.apiKey ?? row.api_key,
      models_json: fields.models ? JSON.stringify(fields.models) : row.models_json,
      is_default: fields.isDefault !== undefined ? (fields.isDefault ? 1 : 0) : row.is_default,
      updated_at: new Date().toISOString(),
    }
    getDb().prepare(`
      UPDATE model_providers SET display_name=@display_name, protocol=@protocol, base_url=@base_url,
        api_key=@api_key, models_json=@models_json, is_default=@is_default, updated_at=@updated_at
      WHERE id=@id
    `).run(updated)
    return updated
  },

  toggle(id: string, enabled: boolean): void {
    getDb().prepare('UPDATE model_providers SET enabled=?, updated_at=? WHERE id=?').run(enabled ? 1 : 0, new Date().toISOString(), id)
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM model_providers WHERE id = ?').run(id)
    log.info({ providerId: id }, '模型供应商已删除')
  },

  setDefault(id: string): void {
    const db = getDb()
    db.prepare('UPDATE model_providers SET is_default=0').run()
    db.prepare('UPDATE model_providers SET is_default=1 WHERE id=?').run(id)
  },
}
