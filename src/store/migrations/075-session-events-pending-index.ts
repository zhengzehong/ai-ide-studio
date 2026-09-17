import type { Migration } from '../migrator.js'

/**
 * session_events 未决项部分索引(2026-09-17 会话拉消息治理 P1)。
 *
 * 用途:团队面板轻量恢复(queries/team-member-state-query.ts)需要拿到该会话**全部**
 * permission/elicitation 事件来做未决项归约 —— 挂起的请求可能埋在很深的历史里
 * (生产实测一条仍未决的 permission.request 位于倒数第 729 条),尾巴扫描看不到。
 *
 * 没有这个索引时,`WHERE session_id=? AND type IN (...)` 只能走
 * idx_session_events_session_sequence(session_id, sequence) 顺序扫描该会话的**全部**事件,
 * 再逐行回表取 type 过滤 —— 而 message.chunk 占绝对多数,等于为了几条 permission 事件
 * 扫过整个会话历史。
 *
 * 部分索引只覆盖这四类事件,查询谓词与索引 WHERE 完全一致,SQLite 可直接用索引区间扫描,
 * 代价与会话历史长度无关。
 *
 * 类型清单来源:ui/src/stores/session-events.ts:826-851 的 applySessionEvent 映射 ——
 * 只有这四类事件会改动 pendingPermissions / pendingElicitations。
 *
 * 实测(生产数据副本,见实施报告):构建耗时/索引体积以副本库实测值为准;
 * 构建是一次性全表扫描(2.9M 行),建议与 074 一起在低峰窗口随服务重启生效。
 *
 * 回滚:DROP INDEX idx_session_events_pending_lookup;
 */
export const sessionEventsPendingIndexMigration: Migration = {
  version: '075',
  name: 'session_events_pending_index',
  up(db): void {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_session_events_pending_lookup
        ON session_events(session_id, sequence)
        WHERE type IN ('permission.request','permission.result','elicitation.request','elicitation.result');
    `)
  },
}
