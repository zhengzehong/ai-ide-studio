import { randomUUID } from 'crypto'
import { getDb } from './db.js'
import { createChildLogger } from '../core/logger.js'
import type { ToolType, ToolCategory, ToolConfig, ToolPermissions, BindingScope } from '../tools/types.js'

const log = createChildLogger('store:tool')

export interface ToolRow {
  id: string
  name: string
  display_name: string
  description: string
  category: string
  type: string
  config_json: string
  input_schema_json: string | null
  permissions_json: string
  enabled: number
  is_builtin: number
  created_at: string
  updated_at: string
}

export interface ToolBindingRow {
  id: string
  tool_id: string
  scope: string
  target_id: string | null
  enabled: number
  config_override_json: string | null
  created_at: string
}

export interface CreateToolInput {
  name: string
  displayName: string
  description: string
  category: ToolCategory
  type: ToolType
  config: ToolConfig
  inputSchema?: object
  permissions?: ToolPermissions
  isBuiltin?: boolean
}

export const toolStore = {
  create(input: CreateToolInput): ToolRow {
    const now = new Date().toISOString()
    const defaultPerms = { requiresApproval: false, maxExecutionTime: 30000, networkAccess: false }
    const row: ToolRow = {
      id: `tool-${randomUUID().slice(0, 8)}`,
      name: input.name,
      display_name: input.displayName,
      description: input.description,
      category: input.category,
      type: input.type,
      config_json: JSON.stringify(input.config),
      input_schema_json: input.inputSchema ? JSON.stringify(input.inputSchema) : null,
      permissions_json: JSON.stringify(input.permissions ?? defaultPerms),
      enabled: 1,
      is_builtin: input.isBuiltin ? 1 : 0,
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO tools (id, name, display_name, description, category, type, config_json, input_schema_json, permissions_json, enabled, is_builtin, created_at, updated_at)
      VALUES (@id, @name, @display_name, @description, @category, @type, @config_json, @input_schema_json, @permissions_json, @enabled, @is_builtin, @created_at, @updated_at)
    `).run(row)
    log.info({ toolId: row.id, name: row.name, type: row.type }, '工具已注册')
    return row
  },

  get(id: string): ToolRow | undefined {
    return getDb().prepare<[string], ToolRow>('SELECT * FROM tools WHERE id = ?').get(id)
  },

  getByName(name: string): ToolRow | undefined {
    return getDb().prepare<[string], ToolRow>('SELECT * FROM tools WHERE name = ?').get(name)
  },

  list(): ToolRow[] {
    return getDb().prepare<[], ToolRow>('SELECT * FROM tools ORDER BY is_builtin DESC, category, name').all()
  },

  update(id: string, fields: Partial<Omit<CreateToolInput, 'isBuiltin'>>): ToolRow | undefined {
    const tool = toolStore.get(id)
    if (!tool) return undefined

    const updated: ToolRow = {
      ...tool,
      display_name: fields.displayName ?? tool.display_name,
      description: fields.description ?? tool.description,
      category: fields.category ?? tool.category,
      type: fields.type ?? tool.type,
      config_json: fields.config ? JSON.stringify(fields.config) : tool.config_json,
      input_schema_json: fields.inputSchema ? JSON.stringify(fields.inputSchema) : tool.input_schema_json,
      permissions_json: fields.permissions ? JSON.stringify(fields.permissions) : tool.permissions_json,
      updated_at: new Date().toISOString(),
    }
    getDb().prepare(`
      UPDATE tools SET display_name=@display_name, description=@description, category=@category,
        type=@type, config_json=@config_json, input_schema_json=@input_schema_json,
        permissions_json=@permissions_json, updated_at=@updated_at
      WHERE id=@id
    `).run(updated)
    return updated
  },

  toggle(id: string, enabled: boolean): void {
    getDb().prepare('UPDATE tools SET enabled=?, updated_at=? WHERE id=?').run(enabled ? 1 : 0, new Date().toISOString(), id)
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM tool_bindings WHERE tool_id = ?').run(id)
    getDb().prepare('DELETE FROM tools WHERE id = ?').run(id)
    log.info({ toolId: id }, '工具已删除')
  },
}

export const toolBindingStore = {
  set(toolId: string, scope: BindingScope, targetId: string | null, configOverride?: Record<string, unknown>): ToolBindingRow {
    const existing = getDb().prepare<[string, string, string | null], ToolBindingRow>(
      'SELECT * FROM tool_bindings WHERE tool_id=? AND scope=? AND target_id IS ?',
    ).get(toolId, scope, targetId)

    if (existing) {
      getDb().prepare('UPDATE tool_bindings SET enabled=1, config_override_json=? WHERE id=?').run(
        configOverride ? JSON.stringify(configOverride) : null,
        existing.id,
      )
      return { ...existing, enabled: 1, config_override_json: configOverride ? JSON.stringify(configOverride) : null }
    }

    const row: ToolBindingRow = {
      id: `tb-${randomUUID().slice(0, 8)}`,
      tool_id: toolId,
      scope,
      target_id: targetId,
      enabled: 1,
      config_override_json: configOverride ? JSON.stringify(configOverride) : null,
      created_at: new Date().toISOString(),
    }
    getDb().prepare(`
      INSERT INTO tool_bindings (id, tool_id, scope, target_id, enabled, config_override_json, created_at)
      VALUES (@id, @tool_id, @scope, @target_id, @enabled, @config_override_json, @created_at)
    `).run(row)
    log.info({ bindingId: row.id, toolId, scope, targetId }, '工具绑定已创建')
    return row
  },

  remove(toolId: string, scope: BindingScope, targetId: string | null): void {
    getDb().prepare('DELETE FROM tool_bindings WHERE tool_id=? AND scope=? AND target_id IS ?').run(toolId, scope, targetId)
  },

  list(toolId?: string): ToolBindingRow[] {
    if (toolId) {
      return getDb().prepare<[string], ToolBindingRow>('SELECT * FROM tool_bindings WHERE tool_id=? ORDER BY scope').all(toolId)
    }
    return getDb().prepare<[], ToolBindingRow>('SELECT * FROM tool_bindings ORDER BY tool_id, scope').all()
  },

  listByTarget(scope: BindingScope, targetId: string | null): ToolBindingRow[] {
    return getDb().prepare<[string, string | null], ToolBindingRow>(
      'SELECT * FROM tool_bindings WHERE scope=? AND target_id IS ? AND enabled=1',
    ).all(scope, targetId)
  },
}
