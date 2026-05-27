import { randomUUID } from 'crypto'
import { getDb } from './db.js'
import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('store:skill')

export type SkillType = 'prompt' | 'file' | 'mcp'

export interface SkillRow {
  id: string
  name: string
  display_name: string
  description: string
  type: string
  content: string
  category: string
  enabled: number
  is_builtin: number
  created_at: string
  updated_at: string
}

export interface SkillBindingRow {
  id: string
  skill_id: string
  scope: string
  target_id: string | null
  enabled: number
  created_at: string
}

export interface CreateSkillInput {
  name: string
  displayName: string
  description?: string
  type?: SkillType
  content: string
  category?: string
  isBuiltin?: boolean
}

export const skillStore = {
  create(input: CreateSkillInput): SkillRow {
    const now = new Date().toISOString()
    const row: SkillRow = {
      id: `skill-${randomUUID().slice(0, 8)}`,
      name: input.name,
      display_name: input.displayName,
      description: input.description ?? '',
      type: input.type ?? 'prompt',
      content: input.content,
      category: input.category ?? 'general',
      enabled: 1,
      is_builtin: input.isBuiltin ? 1 : 0,
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO skills (id, name, display_name, description, type, content, category, enabled, is_builtin, created_at, updated_at)
      VALUES (@id, @name, @display_name, @description, @type, @content, @category, @enabled, @is_builtin, @created_at, @updated_at)
    `).run(row)
    log.info({ skillId: row.id, name: row.name }, '技能已创建')
    return row
  },

  get(id: string): SkillRow | undefined {
    return getDb().prepare<[string], SkillRow>('SELECT * FROM skills WHERE id = ?').get(id)
  },

  list(): SkillRow[] {
    return getDb().prepare<[], SkillRow>('SELECT * FROM skills ORDER BY is_builtin DESC, category, name').all()
  },

  update(id: string, fields: Partial<CreateSkillInput>): SkillRow | undefined {
    const row = skillStore.get(id)
    if (!row) return undefined
    const updated: SkillRow = {
      ...row,
      display_name: fields.displayName ?? row.display_name,
      description: fields.description ?? row.description,
      type: fields.type ?? row.type,
      content: fields.content ?? row.content,
      category: fields.category ?? row.category,
      updated_at: new Date().toISOString(),
    }
    getDb().prepare(`
      UPDATE skills SET display_name=@display_name, description=@description, type=@type,
        content=@content, category=@category, updated_at=@updated_at WHERE id=@id
    `).run(updated)
    return updated
  },

  toggle(id: string, enabled: boolean): void {
    getDb().prepare('UPDATE skills SET enabled=?, updated_at=? WHERE id=?').run(enabled ? 1 : 0, new Date().toISOString(), id)
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM skill_bindings WHERE skill_id = ?').run(id)
    getDb().prepare('DELETE FROM skills WHERE id = ?').run(id)
    log.info({ skillId: id }, '技能已删除')
  },
}

export const skillBindingStore = {
  set(skillId: string, scope: 'global' | 'project' | 'agent', targetId: string | null): SkillBindingRow {
    const existing = getDb().prepare<[string, string, string | null], SkillBindingRow>(
      'SELECT * FROM skill_bindings WHERE skill_id=? AND scope=? AND target_id IS ?',
    ).get(skillId, scope, targetId)

    if (existing) {
      getDb().prepare('UPDATE skill_bindings SET enabled=1 WHERE id=?').run(existing.id)
      return { ...existing, enabled: 1 }
    }

    const row: SkillBindingRow = {
      id: `sb-${randomUUID().slice(0, 8)}`,
      skill_id: skillId,
      scope,
      target_id: targetId,
      enabled: 1,
      created_at: new Date().toISOString(),
    }
    getDb().prepare(`
      INSERT INTO skill_bindings (id, skill_id, scope, target_id, enabled, created_at)
      VALUES (@id, @skill_id, @scope, @target_id, @enabled, @created_at)
    `).run(row)
    return row
  },

  remove(skillId: string, scope: string, targetId: string | null): void {
    getDb().prepare('DELETE FROM skill_bindings WHERE skill_id=? AND scope=? AND target_id IS ?').run(skillId, scope, targetId)
  },

  list(skillId?: string): SkillBindingRow[] {
    if (skillId) {
      return getDb().prepare<[string], SkillBindingRow>('SELECT * FROM skill_bindings WHERE skill_id=?').all(skillId)
    }
    return getDb().prepare<[], SkillBindingRow>('SELECT * FROM skill_bindings ORDER BY skill_id, scope').all()
  },
}
