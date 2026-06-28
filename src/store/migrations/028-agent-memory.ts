import type { Migration } from '../migrator.js'

export const agentMemoryMigration: Migration = {
  version: '028',
  name: 'agent-memory',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_memory_dimensions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        prompt TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_dimensions_unique
        ON agent_memory_dimensions(project_id, agent_id, name)
        WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_agent_memory_dimensions_agent
        ON agent_memory_dimensions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_memory_dimensions_project
        ON agent_memory_dimensions(project_id);

      CREATE TABLE IF NOT EXISTS agent_memory_entries (
        id TEXT PRIMARY KEY,
        dimension_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        source_session_id TEXT,
        source_task_id TEXT,
        confidence REAL NOT NULL DEFAULT 1.0,
        pinned INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        use_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_agent_memory_entries_dimension
        ON agent_memory_entries(dimension_id);
      CREATE INDEX IF NOT EXISTS idx_agent_memory_entries_pinned
        ON agent_memory_entries(dimension_id, pinned);
      CREATE INDEX IF NOT EXISTS idx_agent_memory_entries_use_count
        ON agent_memory_entries(dimension_id, use_count);

      CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts USING fts5(
        entry_id UNINDEXED,
        title,
        content,
        tags,
        tokenize = 'trigram'
      );

      CREATE TRIGGER IF NOT EXISTS agent_memory_fts_ai AFTER INSERT ON agent_memory_entries BEGIN
        INSERT INTO agent_memory_fts(entry_id, title, content, tags)
        VALUES (new.id, new.title, new.content, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS agent_memory_fts_ad AFTER DELETE ON agent_memory_entries BEGIN
        DELETE FROM agent_memory_fts WHERE entry_id = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS agent_memory_fts_au AFTER UPDATE ON agent_memory_entries BEGIN
        DELETE FROM agent_memory_fts WHERE entry_id = old.id;
        INSERT INTO agent_memory_fts(entry_id, title, content, tags)
        VALUES (new.id, new.title, new.content, new.tags);
      END;
    `)
  },
}
