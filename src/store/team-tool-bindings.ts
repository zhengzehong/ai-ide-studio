import { getDb } from './db.js'
import type { SqliteDatabase } from './migrator.js'

/**
 * 团队工具 agent 作用域绑定的幂等补齐（存量团队）。
 *
 * 背景：团队工具靠 agent 作用域绑定下发（`applyToolProfileToAgent` 只在建团/加成员时写），
 * 团队工具没有 global 绑定（见 tools/agent-tool-exposure.ts 注释），解析器对 team.* 还要求 binding.scope === 'agent'。
 * 因此**后新增**的团队工具（如 team.status）对存量团队不可见；而"仅新团队生效"不可接受。
 *
 * 两个调用点（都必须幂等）：
 * 1) 启动对账：`seedBuiltinTools()` 之后调用（app.ts）——工具行此时才存在，是干净升级路径的真正兜底；
 * 2) migration 073：只对"迁移时工具已存在"的库生效（历史库），保留不删。
 *
 * 语义：只为 (tool, agent) 完全没有绑定行的组合插入 enabled=1；已存在的绑定（含被显式关闭 enabled=0 的）
 * 一律不动，避免覆盖用户/既有配置。工具表为空（全新库，尚未 seed）直接跳过。
 *
 * 工具名单与 src/tools/team-profiles.ts 的 TEAM_MEMBER_TOOLS / TEAM_LEADER_TOOLS 一致；
 * 因 store/db → migrations → tools/team-profiles → store/tools → store/db 会成环，这里内联维护，
 * 新增团队工具时同步本文件（启动对账会让它自动覆盖存量团队）。
 */
const MEMBER_TOOL_NAMES = [
  'team.list', 'team.conversation.list', 'team.get', 'team.status',
  'team.member.list', 'team.task.list', 'team.mailbox.list',
  'team.mailbox.send', 'team.task.update',
]

const LEADER_TOOL_NAMES = [
  ...MEMBER_TOOL_NAMES,
  'team.create', 'team.update', 'team.member.spawn', 'team.member.message',
  'team.task.create', 'team.template.list', 'team.template.describe',
]

/**
 * 补齐存量团队缺失的团队工具绑定。
 * @returns 本次实际插入的绑定行数（0 = 无缺失或环境不满足，属正常）。
 */
export function ensureTeamToolBindings(db: SqliteDatabase = getDb()): number {
  const toolIds = new Map<string, string>()
  for (const row of db.prepare<[], { id: string; name: string }>('SELECT id, name FROM tools').all()) {
    toolIds.set(row.name, row.id)
  }
  // 全新库：内置工具还没 seed，没有可回填的对象（建团时正常绑定）。
  if (toolIds.size === 0) return 0

  const roleByAgent = new Map<string, string>()
  for (const row of db.prepare<[], { agent_id: string; role: string }>(
    "SELECT DISTINCT agent_id, role FROM team_members WHERE status = 'active'",
  ).all()) {
    // 同一 Agent 在多团队有不同角色时按最高权限（leader）回填。
    if (row.role === 'leader' || !roleByAgent.has(row.agent_id)) roleByAgent.set(row.agent_id, row.role)
  }
  if (roleByAgent.size === 0) return 0

  const hasBinding = db.prepare<[string, string], { found: number }>(
    "SELECT 1 AS found FROM tool_bindings WHERE tool_id = ? AND scope = 'agent' AND target_id = ? LIMIT 1",
  )
  const insertBinding = db.prepare(
    `INSERT INTO tool_bindings (id, tool_id, scope, target_id, enabled, config_override_json, created_at)
     VALUES (?, ?, 'agent', ?, 1, NULL, ?)`,
  )

  const now = new Date().toISOString()
  let inserted = 0
  const backfill = db.transaction(() => {
    for (const [agentId, role] of roleByAgent) {
      const names = role === 'leader' ? LEADER_TOOL_NAMES : MEMBER_TOOL_NAMES
      for (const name of names) {
        const toolId = toolIds.get(name)
        if (!toolId) continue
        if (hasBinding.get(toolId, agentId)) continue
        insertBinding.run(`tb-${agentId}-${toolId}`, toolId, agentId, now)
        inserted += 1
      }
    }
  })
  backfill()
  return inserted
}
