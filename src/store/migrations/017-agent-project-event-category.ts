import type { Migration } from '../migrator.js'

export const agentProjectEventCategoryMigration: Migration = {
  version: '017',
  name: 'agent-project-event-category',
  up(db) {
    const schema = {
      type: 'object',
      properties: {
        projectName: { type: 'string' },
        projectUrl: { type: 'string' },
        agentName: { type: 'string' },
        agentId: { type: 'string' },
        status: { type: 'string' },
        reason: { type: 'string' },
        recommendedAction: { type: 'string' },
      },
    }

    db.prepare(`
      INSERT OR IGNORE INTO event_categories (
        id, name, description, schema_json, default_priority,
        allowed_writers_json, allowed_consumers_json, enabled, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, '["*"]', '["*"]', 1, datetime('now'), datetime('now'))
    `).run(
      'agent.project',
      'Agent项目',
      '记录 Agent 发现、创建、推荐或需要跟进的项目线索。',
      JSON.stringify(schema),
      'medium',
    )
  },
}
