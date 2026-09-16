import type { Migration } from '../migrator.js'

/**
 * 成员级默认档位（P0 数据基座，migration 072）：
 * - reasoning_effort: 成员默认思考强度（NULL=跟随模型档案 / 系统默认）。
 * - 语义是"默认值"不是"强制值"：经 AgentRuntimeEnvOptions.effortOverride → appliedProfile.effort →
 *   applyConfigPreferences 既有通道下发；会话内手切档位（runtime preferences）仍然优先。
 * - 懒生效：仅影响之后新拉起/重启的 runtime（写入后下一回合咬合，不打断执行中回合）。
 * - 完全仿 070 的 PRAGMA table_info + ALTER 模式（SQLite 无 IF NOT EXISTS 列语法）。
 */
export const teamMemberEffortMigration: Migration = {
  version: '072',
  name: 'team_member_effort',
  up(db): void {
    const columns = db.prepare<[], { name: string }>('PRAGMA table_info(team_members)').all()
    if (!columns.some((column) => column.name === 'reasoning_effort')) {
      db.exec('ALTER TABLE team_members ADD COLUMN reasoning_effort TEXT')
    }
  },
}
