import type { Migration } from '../migrator.js'

export const devicesMigration: Migration = {
  version: '063',
  name: 'devices',
  up(db): void {
    db.exec(`
      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT NOT NULL CHECK(platform = 'win32'),
        shells_json TEXT NOT NULL,
        paths_json TEXT NOT NULL DEFAULT '{}',
        os_version TEXT NOT NULL DEFAULT '',
        public_key TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
        revoked_at TEXT,
        last_seen_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE device_pairings (
        code_hash TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );
      CREATE TABLE device_jobs (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id),
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        type TEXT NOT NULL CHECK(type IN ('shell', 'file.upload', 'file.download')),
        state TEXT NOT NULL CHECK(state IN ('queued', 'running', 'succeeded', 'failed', 'cancel_requested', 'cancelled', 'timed_out', 'unknown')),
        request_json TEXT NOT NULL,
        result_json TEXT,
        file_id TEXT UNIQUE,
        file_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deadline_at INTEGER NOT NULL
      );
      CREATE INDEX idx_device_jobs_device ON device_jobs(device_id, state);
      CREATE INDEX idx_device_jobs_session ON device_jobs(session_id, created_at);
    `)
  },
}
