import type { Migration } from '../migrator.js'

export const toolPlatformMigration: Migration = {
  version: '003',
  name: 'tool_platform',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tools (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        type TEXT NOT NULL,
        config_json TEXT NOT NULL,
        input_schema_json TEXT,
        permissions_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tool_bindings (
        id TEXT PRIMARY KEY,
        tool_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        target_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        config_override_json TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(tool_id, scope, target_id)
      );

      CREATE TABLE IF NOT EXISTS tool_contexts (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL,
        acp_session_id TEXT,
        agent_id TEXT NOT NULL,
        project_id TEXT,
        visible_tools_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tool_contexts_token_hash ON tool_contexts(token_hash);
      CREATE INDEX IF NOT EXISTS idx_tool_contexts_session ON tool_contexts(session_id);

      CREATE TABLE IF NOT EXISTS tool_call_audit (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        project_id TEXT,
        tool_name TEXT NOT NULL,
        input_json TEXT NOT NULL,
        output_json TEXT,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tool_call_audit_session ON tool_call_audit(session_id);
      CREATE INDEX IF NOT EXISTS idx_tool_call_audit_tool ON tool_call_audit(tool_name);
    `)
  },
}
