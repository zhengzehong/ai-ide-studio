import type { Migration } from '../migrator.js'
import { lightweightFileChangesJson, parseFileChangesJson } from '../file-changes.js'

/**
 * messages.file_changes_json 死数据清理(2026-09-17 会话拉消息治理 P1·瘦身)。
 *
 * 背景:writer 的 aggregateFileChanges 曾用 `{...file}` 把 turn_process_items.detail_json
 * 里的文件项整包写进 messages.file_changes_json —— 而 detail_json 的文件项还带
 * segments(oldText/newText/lines,即 diff 正文)。列表读取路径(lightweightMessage →
 * parseFileChangesJson)只认 path/changeType/addedLines/deletedLines,
 * 这些 segments 从来不参与任何渲染(detail 端点 sessions.messageFileChanges 也是
 * `{...file, segments: []}`,不读它),纯属死重量。
 *
 * 生产实测(2026-09-17,传数据副本):
 *   - 带 segments 的行 1,388 行 / 156.6MB(占 file_changes_json 总量 157.8MB 的 99.2%);
 *   - 清理耗时 2.02s;清理后该列从 157.8MB → 1.8MB,messages 表 300MB → 138MB(VACUUM 后);
 *   - 列表页读取字节 p90 466KB → 132KB、最大 4.94MB → 180KB。
 * 受影响行是 2026-08/09 写入的(写入侧已在同一批次修复,不会再产生新死数据)。
 *
 * 实现要点:复用运行时同一个 lightweightFileChangesJson()(而不是 SQL 端重建 JSON),
 * 保证清理结果与列表读取路径的语义逐字一致;只在解析成功且确有 segments 时改写,
 * 空值/无法解析的行原样保留(宁可不清理,不可丢数据)。
 *
 * 回滚:此迁移不可逆(丢弃的是从未被读取的冗余字段);若需保留,部署前备份 messages 表。
 */
export const messagesFileChangesSlimMigration: Migration = {
  version: '076',
  name: 'messages_file_changes_slim',
  up(db): void {
    const rows = db.prepare<[], { id: string; file_changes_json: string | null }>(`
      SELECT id, file_changes_json FROM messages WHERE file_changes_json IS NOT NULL
    `).all()
    const update = db.prepare('UPDATE messages SET file_changes_json = ? WHERE id = ?')
    for (const row of rows) {
      const parsed = parseFileChangesJson(row.file_changes_json)
      if (!parsed) continue
      const hasSegments = parsed.files.some((file) => (file as unknown as Record<string, unknown>).segments !== undefined)
      if (!hasSegments) continue
      const light = lightweightFileChangesJson(row.file_changes_json)
      if (light === null) continue
      update.run(light, row.id)
    }
  },
}
