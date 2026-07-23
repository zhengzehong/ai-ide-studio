import type { Migration } from '../migrator.js'
import { presentationsFromToolCalls, type PreviewPresentation } from '../../core/message-presentations.js'

export const messagePresentationsMigration: Migration = {
  version: '047',
  name: 'message-presentations',
  up(db) {
    const columns = db.prepare<[], { name: string }>('PRAGMA table_info(messages)').all()
    if (!columns.some((column) => column.name === 'presentations_json')) {
      db.exec('ALTER TABLE messages ADD COLUMN presentations_json TEXT')
    }

    const rows = db.prepare<[], { message_id: string; detail_json: string }>(`
      SELECT p.message_id, p.detail_json
      FROM turn_process_items p
      JOIN messages m ON m.id = p.message_id
      WHERE p.kind = 'tool'
        AND p.title IN ('preview.publish', 'mcp__ai-ide-tools__preview_publish')
        AND p.detail_json IS NOT NULL
        AND m.presentations_json IS NULL
      ORDER BY p.message_id ASC, p.id ASC
    `).all()
    const byMessage = new Map<string, PreviewPresentation[]>()
    for (const row of rows) {
      let toolCall: unknown
      try {
        toolCall = JSON.parse(row.detail_json) as unknown
      } catch {
        continue
      }
      const presentations = presentationsFromToolCalls([toolCall])
      if (presentations.length === 0) continue
      byMessage.set(row.message_id, [...(byMessage.get(row.message_id) ?? []), ...presentations])
    }
    const update = db.prepare('UPDATE messages SET presentations_json = ? WHERE id = ?')
    for (const [messageId, presentations] of byMessage) {
      update.run(JSON.stringify(presentations), messageId)
    }
  },
}
