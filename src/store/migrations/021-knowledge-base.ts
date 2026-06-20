import type { Migration } from '../migrator.js'

export const knowledgeBaseMigration: Migration = {
  version: '021',
  name: 'knowledge-base',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_bases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        src TEXT NOT NULL,
        icon TEXT,
        description TEXT,
        project_id TEXT,
        index_page_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_bases_project_unique
        ON knowledge_bases(project_id)
        WHERE kind = 'project' AND deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_knowledge_bases_project
        ON knowledge_bases(project_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_bases_kind_src
        ON knowledge_bases(kind, src);

      CREATE TABLE IF NOT EXISTS knowledge_pages (
        id TEXT PRIMARY KEY,
        kb_id TEXT NOT NULL,
        title TEXT NOT NULL,
        title_norm TEXT NOT NULL,
        section TEXT,
        summary TEXT,
        body TEXT NOT NULL,
        author TEXT NOT NULL,
        by TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        is_index INTEGER NOT NULL DEFAULT 0,
        src_files_json TEXT NOT NULL DEFAULT '[]',
        src_fingerprint_json TEXT,
        stale INTEGER NOT NULL DEFAULT 0,
        last_human_edit_at TEXT,
        last_activity_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_pages_title_unique
        ON knowledge_pages(kb_id, title_norm)
        WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_knowledge_pages_kb_section
        ON knowledge_pages(kb_id, section);
      CREATE INDEX IF NOT EXISTS idx_knowledge_pages_stale
        ON knowledge_pages(kb_id, stale);
      CREATE INDEX IF NOT EXISTS idx_knowledge_pages_index
        ON knowledge_pages(kb_id, is_index);

      CREATE TABLE IF NOT EXISTS knowledge_mounts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        kb_id TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_mounts_unique
        ON knowledge_mounts(project_id, kb_id)
        WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_knowledge_mounts_project
        ON knowledge_mounts(project_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_mounts_kb
        ON knowledge_mounts(kb_id);

      CREATE TABLE IF NOT EXISTS knowledge_activities (
        id TEXT PRIMARY KEY,
        kb_id TEXT NOT NULL,
        page_id TEXT,
        act TEXT NOT NULL,
        actor TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        tool TEXT NOT NULL,
        note TEXT,
        prev_body TEXT,
        prev_snapshot_json TEXT,
        next_snapshot_json TEXT,
        reverted_at TEXT,
        reverted_by TEXT,
        revert_activity_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_activities_kb_created
        ON knowledge_activities(kb_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_knowledge_activities_page_created
        ON knowledge_activities(page_id, created_at);
    `)
  },
}
