import { presentationsFromToolCalls } from '../../core/message-presentations.js'
import type { Migration } from '../migrator.js'

export const messagePresentationRepairMigration: Migration = {
  version: '048',
  name: 'message-presentation-repair',
  up(db) {
    const rows = db.prepare<[], { message_id: string; detail_json: string }>(`
      SELECT p.message_id, p.detail_json
      FROM turn_process_items p
      JOIN messages m ON m.id = p.message_id
      WHERE p.kind = 'tool'
        AND p.title IN (
          'files.present',
          'mcp__ai-ide-tools__files_present',
          'mcp.ai-ide-tools.files.present',
          'ai-ide-tools.files.present',
          'preview.publish',
          'mcp__ai-ide-tools__preview_publish',
          'mcp.ai-ide-tools.preview.publish',
          'ai-ide-tools.preview.publish'
        )
        AND p.detail_json IS NOT NULL
        AND m.presentations_json IS NULL
      ORDER BY p.message_id ASC, p.id ASC
    `).all()
    const toolCallsByMessage = new Map<string, unknown[]>()
    for (const row of rows) {
      let toolCall: unknown
      try {
        toolCall = JSON.parse(row.detail_json) as unknown
      } catch {
        continue
      }
      toolCallsByMessage.set(row.message_id, [
        ...(toolCallsByMessage.get(row.message_id) ?? []),
        toolCall,
      ])
    }
    const update = db.prepare('UPDATE messages SET presentations_json = ? WHERE id = ?')
    for (const [messageId, toolCalls] of toolCallsByMessage) {
      const presentations = presentationsFromToolCalls(toolCalls)
      if (presentations.length > 0) update.run(JSON.stringify(presentations), messageId)
    }
  },
}
