import type { Migration } from '../migrator.js'

/**
 * team_mailbox 会话线归属（团队邮箱硬隔离 v3，2026-09-17）。
 *
 * 背景：team_mailbox 此前没有"会话线"维度，mailbox 是团队全局的——
 * 任何一条线的 Master 调 team.get / team.mailbox.list 都会看到全团队所有线的汇报/任务，
 * 表现为"串线"（他线汇报出现在本线 Master 的视野里）。
 *
 * 本迁移只加列与索引，**不回填**：写入侧（core/team-line-scope.ts 四级兜底）从本版本起强制归属，
 * 存量 NULL 行按"归属缺省"处理——只在团队默认线（最早的活跃线）可见，不会同时出现在多条线。
 * 回填需要逐行反查 session → 线，与运行期同口径但会固化历史瞬时状态，收益不抵风险。
 *
 * 回滚：DROP INDEX idx_team_mailbox_conversation; （列保留，SQLite 3.35 以下不支持 DROP COLUMN）
 */
export const teamMailboxConversationMigration: Migration = {
  version: '077',
  name: 'team_mailbox_conversation',
  up(db): void {
    db.exec(`
      ALTER TABLE team_mailbox ADD COLUMN conversation_id TEXT;
    `)
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_team_mailbox_conversation
        ON team_mailbox(team_id, conversation_id, created_at DESC);
    `)
  },
}
