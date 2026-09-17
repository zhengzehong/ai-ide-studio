import type { Migration } from '../migrator.js'

/**
 * event_center_events 列表页索引(2026-09-16 夜间卡顿 P0-2)。
 *
 * 现状:listPage 的 `ORDER BY created_at DESC, rowid DESC` 没有匹配索引,
 * 只能走 idx_event_center_events_dedupe(project_id) 过滤后
 * `USE TEMP B-TREE FOR ORDER BY` —— 排序发生在 LIMIT 之前,要读完全部候选
 * (最大项目 7,697 行;全表 19,676 行)。
 *
 * 实测(生产数据忠实副本,19,679 行 / 16.4MB):
 *   建索引 11.3ms / 索引体积 904KB;listPage 查询 2.95~3.54ms → 0.03~0.14ms。
 *   created_at 近似全局唯一(19,667 行 / 19,667 个不同值,最大重复 2),
 *   因此 EXPLAIN 里残留的 `TEMP B-TREE FOR LAST TERM OF ORDER BY` 只作用于
 *   相同 created_at 的 <=2 行,可忽略 —— 业务 SQL 一行都不用改。
 *
 * 注:`(project_id, created_at DESC, rowid DESC)` 变体不可用 ——
 * SQLite 不允许 rowid 作为索引列(SQLITE_ERROR: no such column: rowid)。
 *
 * 回滚:DROP INDEX idx_event_center_events_project_created;
 */
export const eventCenterListIndexMigration: Migration = {
  version: '074',
  name: 'event_center_list_index',
  up(db): void {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_event_center_events_project_created
        ON event_center_events(project_id, created_at DESC);
    `)
  },
}
