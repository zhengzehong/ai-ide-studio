import type { Migration } from '../migrator.js'
import { ensureTeamToolBindings } from '../team-tool-bindings.js'

/**
 * 存量团队的团队工具绑定回填（migration 073）。
 *
 * ⚠️ 启动顺序陷阱：runMigrations 早于 seedBuiltinTools，干净升级库跑本迁移时 tools 表里还没有
 * team.status 行 → 迁移空转、版本已记录且永不重跑。因此真正的兜底是 **app.ts 在 seedBuiltinTools()
 * 之后的 `ensureTeamToolBindings()` 启动对账**（见 store/team-tool-bindings.ts）；
 * 本迁移保留，只对"迁移时工具行已存在"的历史库生效，二者共用同一幂等函数。
 */
export const teamToolBindingsBackfillMigration: Migration = {
  version: '073',
  name: 'team_tool_bindings_backfill',
  up(db): void {
    ensureTeamToolBindings(db)
  },
}
