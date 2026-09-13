import type { Migration } from '../migrator.js'

/**
 * 团队成员级配置：模型策略 + 系统提示词覆盖（TeamAgentDock 设置弹窗）。
 * - model_profile_mode: 'inherit'（继承 Master）| 'fixed'（固定模型档案）| 'system'（系统默认），新行默认 inherit。
 * - 历史行为保持：migration 067 时代 spawn 时写入 model_profile_id 即"固定档案"，这里回填为 fixed。
 * - system_prompt_override: 仅对当前团队生效的成员系统提示词覆盖，留空则继承。
 */
export const teamMemberConfigMigration: Migration = {
  version: '070',
  name: 'team_member_config',
  up(db): void {
    const columns = db.prepare<[], { name: string }>('PRAGMA table_info(team_members)').all()
    if (!columns.some((column) => column.name === 'model_profile_mode')) {
      db.exec(`ALTER TABLE team_members ADD COLUMN model_profile_mode TEXT NOT NULL DEFAULT 'inherit'`)
    }
    if (!columns.some((column) => column.name === 'system_prompt_override')) {
      db.exec('ALTER TABLE team_members ADD COLUMN system_prompt_override TEXT')
    }
    db.exec(`
      UPDATE team_members
      SET model_profile_mode = 'fixed'
      WHERE model_profile_id IS NOT NULL AND model_profile_mode = 'inherit'
    `)
  },
}
