import type { Migration } from '../migrator.js'

export const eventCenterMigration: Migration = {
  version: '014',
  name: 'event-center',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS event_categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        schema_json TEXT NOT NULL,
        default_priority TEXT NOT NULL DEFAULT 'medium',
        allowed_writers_json TEXT NOT NULL DEFAULT '["*"]',
        allowed_consumers_json TEXT NOT NULL DEFAULT '["*"]',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS event_center_events (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        category_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        source_type TEXT NOT NULL DEFAULT 'agent',
        source_id TEXT,
        source_label TEXT,
        priority TEXT NOT NULL DEFAULT 'medium',
        confidence REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        tags_json TEXT NOT NULL DEFAULT '[]',
        payload_json TEXT NOT NULL DEFAULT '{}',
        evidence_json TEXT NOT NULL DEFAULT '[]',
        dedupe_key TEXT,
        created_by_agent_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS event_subscriptions (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        name TEXT NOT NULL,
        category_id TEXT NOT NULL,
        consumer_agent_id TEXT,
        consumer_label TEXT,
        action_mode TEXT NOT NULL DEFAULT 'create_pending',
        filter_json TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        auto_start INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS event_consumptions (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        subscription_id TEXT,
        project_id TEXT,
        consumer_agent_id TEXT,
        consumer_label TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        result_summary TEXT,
        result_json TEXT,
        error TEXT,
        claimed_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(event_id, subscription_id, consumer_agent_id)
      );

      CREATE TABLE IF NOT EXISTS event_task_links (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(event_id, task_id)
      );

      CREATE INDEX IF NOT EXISTS idx_event_center_events_project_status
        ON event_center_events(project_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_event_center_events_category
        ON event_center_events(category_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_event_center_events_dedupe
        ON event_center_events(project_id, category_id, dedupe_key);
      CREATE INDEX IF NOT EXISTS idx_event_subscriptions_project_category
        ON event_subscriptions(project_id, category_id, enabled);
      CREATE INDEX IF NOT EXISTS idx_event_consumptions_agent_status
        ON event_consumptions(project_id, consumer_agent_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_event_consumptions_event
        ON event_consumptions(event_id);
    `)

    seedCategory(
      db,
      'ai.hot_project',
      'AI 热门项目',
      '记录新出现或突然升温的 AI 项目，供趋势分析或任务候选判断。',
      ['projectName', 'githubUrl', 'starsDelta', 'hotReason', 'relatedTech', 'recommendedAction'],
      'medium',
    )
    seedCategory(
      db,
      'repo.commit',
      '代码提交',
      '记录代码提交、分支合并和重要工程变更。',
      ['repo', 'branch', 'commit', 'author', 'changedFiles', 'recommendedAction'],
      'medium',
    )
    seedCategory(
      db,
      'task.candidate',
      '任务候选',
      '记录还没有确认是否值得做的潜在任务。',
      ['background', 'suggestedAction', 'impact', 'priority', 'confidence'],
      'high',
    )
    seedCategory(
      db,
      'work.shipped',
      '工作完成',
      '记录已经完成并提交的工作，用于日报、发布说明和复盘。',
      ['commit', 'branch', 'summary', 'verificationCommands', 'followUpSuggestion'],
      'low',
    )
  },
}

function seedCategory(
  db: Parameters<Migration['up']>[0],
  id: string,
  name: string,
  description: string,
  fields: string[],
  defaultPriority: string,
): void {
  const schema = {
    type: 'object',
    properties: Object.fromEntries(fields.map((field) => [field, { type: 'string' }])),
  }
  db.prepare(`
    INSERT OR IGNORE INTO event_categories (
      id, name, description, schema_json, default_priority,
      allowed_writers_json, allowed_consumers_json, enabled, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, '["*"]', '["*"]', 1, datetime('now'), datetime('now'))
  `).run(id, name, description, JSON.stringify(schema), defaultPriority)
}
