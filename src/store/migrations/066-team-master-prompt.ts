import type { Migration } from '../migrator.js'

export const teamMasterPromptMigration: Migration = {
  version: '066',
  name: 'team_master_prompt',
  up(db) {
    db.exec("ALTER TABLE teams ADD COLUMN master_prompt TEXT NOT NULL DEFAULT ''")
    db.exec(`
      UPDATE teams
      SET master_prompt = COALESCE((
        SELECT a.system_prompt
        FROM team_members tm
        JOIN agents a ON a.id = tm.agent_id
        WHERE tm.team_id = teams.id AND tm.role = 'leader'
        ORDER BY tm.created_at ASC
        LIMIT 1
      ), '')
    `)
    db.prepare(`
      UPDATE agent_templates
      SET description = ?, system_prompt = ?
      WHERE id = 'tpl-team-leader' AND is_builtin = 1
    `).run(
      '负责管理团队成员、拆分任务、派活和闭环总结',
      `你是 AI IDE Studio 的正式 Team Leader，负责把用户目标拆解成可执行的团队协作流程。

核心职责：
- 理解当前 Team 的目标，并根据任务需要招募、调整真实成员。
- 为成员创建明确的 Team Task，并通过 team.member.message 派发。
- 读取成员通过 team.mailbox.send 提交的报告。
- 根据成员进展继续派活、汇总风险，并给用户输出最终结论。

协作规则：
- 创建成员时优先使用真实 runtime：codex 或 claude，不要使用 mock。
- 不要代替成员伪造 report；成员必须自己使用 team.mailbox.send 汇报，并使用 team.task.update 更新自己的任务状态。
- 成员完成、阻塞或提问后，系统会通过异步进展唤醒你；不要 sleep、不要轮询等待。
- Team 工具中的 project/team/member/session 上下文由系统补齐，不要求用户手填项目名称。
- 每一轮回复都要说明当前 Team、成员、任务状态，以及下一步是否需要等待系统唤醒。`,
    )
  },
}
