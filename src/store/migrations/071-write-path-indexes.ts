import type { Migration } from '../migrator.js'

/**
 * 写通道 P0 修复配套索引（2026-09-15 Edge 写入拥堵事故）。
 *
 * 背景（EXPLAIN 实证，见 docs/analysis/2026-09-15-edge-source-analysis-v2.md）：
 * 1) 启动对账 `UPDATE messages ... WHERE role='agent' AND status='running'` 与
 *    `UPDATE turn_process_items ... WHERE status IN ('running','pending','in_progress')`
 *    在 9.31GB 库上分别是 skip-scan/全表扫描，实测让 API 子进程启动卡 131s（恢复 2m33s 的 86%）。
 *    这两个状态是"瞬态"：正常情况下命中的行数在个位数到百位数，
 *    因此用**部分索引**（只索引处于该状态的行）即可把两条 UPDATE 变成索引点查，
 *    且对日常写入几乎没有额外开销（索引项只在行进入/离开这些状态时增删）。
 * 2) maintenance 按保留窗口清理 writer_batch_commits（504 万行）时按 committed_at 过滤，
 *    原先没有任何以 committed_at 前导的索引 → 每次清理都是全表扫描；本迁移补上。
 *
 * 部署注意（见实施报告）：三条索引都是一次性构建，SQLite 需要各扫一遍基表；
 * 在 9.31GB / 磁盘剩 14GB 的实例上，预计构建耗时数十秒、额外空间 ~100~200MB。
 * 若担心启动期抖动，可在部署前用 `PRAGMA cache_size` 预热或选择低峰窗口重启。
 * 回滚：DROP INDEX idx_messages_agent_running / idx_turn_process_items_open /
 *       idx_writer_batch_commits_committed_at（均为纯性能索引，删除不丢数据）。
 */
export const writePathIndexesMigration: Migration = {
  version: '071',
  name: 'write_path_indexes',
  up(db): void {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_agent_running
        ON messages(id) WHERE role = 'agent' AND status = 'running';

      CREATE INDEX IF NOT EXISTS idx_turn_process_items_open
        ON turn_process_items(id) WHERE status IN ('running', 'pending', 'in_progress');

      CREATE INDEX IF NOT EXISTS idx_writer_batch_commits_committed_at
        ON writer_batch_commits(committed_at);
    `)
  },
}
