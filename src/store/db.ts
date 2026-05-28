import Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { basename, dirname, resolve } from 'path'
import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('db')

type SqliteDatabase = ReturnType<typeof Database>

type StoreRecord = Record<string, unknown>

interface StoreData {
  agents: Record<string, unknown>
  sessions: Record<string, unknown>
  messages: Record<string, unknown[]>
  events: Record<string, unknown[]>
  tasks: Record<string, unknown>
  rules: Record<string, unknown>
}

let _db: SqliteDatabase | null = null
let _dbPath = ''

export function initDatabase(dbPath: string): void {
  const { sqlitePath, legacyJsonPath } = resolveDatabasePaths(dbPath)

  if (_db && _dbPath !== sqlitePath) {
    _db.close()
    _db = null
    _dbPath = ''
  }

  if (_db && _dbPath === sqlitePath) return

  mkdirSync(dirname(sqlitePath), { recursive: true })
  _db = new Database(sqlitePath)
  _dbPath = sqlitePath
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  createSchema(_db)
  migrateLegacyJsonIfNeeded(_db, legacyJsonPath)
}

export function getDb(): SqliteDatabase {
  if (!_db) throw new Error('Database not initialized. Call initDatabase() first.')
  return _db
}

export function getData(): StoreData {
  const db = getDb()
  const agents = rowsById(db.prepare<[], StoreRecord>('SELECT * FROM agents ORDER BY created_at ASC').all())
  const sessions = rowsById(db.prepare<[], StoreRecord>('SELECT * FROM sessions ORDER BY started_at ASC').all())
  const tasks = rowsById(db.prepare<[], StoreRecord>('SELECT * FROM tasks ORDER BY created_at ASC').all())
  const rules = rowsById(
    db.prepare<[], StoreRecord>('SELECT * FROM rules ORDER BY created_at ASC').all().map((row) => mapRuleRow(row)),
  )

  const messages: Record<string, unknown[]> = {}
  for (const row of db.prepare<[], StoreRecord>('SELECT * FROM messages ORDER BY timestamp ASC').all()) {
    const sessionId = String(row.session_id)
    if (!messages[sessionId]) messages[sessionId] = []
    messages[sessionId].push(row)
  }

  const events: Record<string, unknown[]> = {}
  for (const row of db.prepare<[], StoreRecord>('SELECT * FROM session_events ORDER BY session_id ASC, sequence ASC').all()) {
    const sessionId = String(row.session_id)
    if (!events[sessionId]) events[sessionId] = []
    events[sessionId].push(row)
  }

  return { agents, sessions, messages, events, tasks, rules }
}

export function persist(): void {
  // SQLite writes are synchronous through better-sqlite3; kept for old callers.
}

export function persistSync(): void {
  // SQLite writes are synchronous through better-sqlite3; kept for old callers.
}

export function closeDatabase(): void {
  if (_db) {
    _db.close()
    _db = null
  }
  _dbPath = ''
}

export function getDbPath(): string {
  return _dbPath ? resolve(dirname(_dbPath)) : ''
}

function resolveDatabasePaths(inputPath: string): { sqlitePath: string; legacyJsonPath?: string } {
  const resolved = resolve(inputPath)
  const dir = dirname(resolved)
  const name = basename(resolved)

  if (name === 'ai-ide.db') {
    return { sqlitePath: resolve(dir, 'ai-ide.sqlite'), legacyJsonPath: resolved }
  }

  if (name === 'ai-ide.sqlite') {
    return { sqlitePath: resolved, legacyJsonPath: resolve(dir, 'ai-ide.db') }
  }

  if (name.toLowerCase().endsWith('.json') && existsSync(resolved) && !isSqliteFile(resolved)) {
    return { sqlitePath: resolve(dir, `${name.slice(0, -5)}.sqlite`), legacyJsonPath: resolved }
  }

  return { sqlitePath: resolved }
}

function isSqliteFile(path: string): boolean {
  try {
    return readFileSync(path).subarray(0, 16).toString('utf-8') === 'SQLite format 3\0'
  } catch {
    return false
  }
}

function createSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      runtime TEXT NOT NULL,
      status TEXT NOT NULL,
      permission_level INTEGER NOT NULL,
      config_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      task_id TEXT,
      acp_session_id TEXT,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      started_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      thinking TEXT,
      tool_calls_json TEXT,
      decision_json TEXT,
      attachments_json TEXT,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session_timestamp ON messages(session_id, timestamp);

    CREATE TABLE IF NOT EXISTS session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      agent_id TEXT,
      acp_session_id TEXT,
      message_id TEXT,
      type TEXT NOT NULL,
      role TEXT,
      payload_json TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_events_session_sequence ON session_events(session_id, sequence);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      assigned_agent_id TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_events_task_sequence ON task_events(task_id, sequence);

    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      cron TEXT NOT NULL,
      action TEXT NOT NULL,
      action_config_json TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      last_run_at TEXT,
      next_run_at TEXT,
      run_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      work_dir TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS agent_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      runtime TEXT NOT NULL DEFAULT 'claude',
      icon TEXT NOT NULL DEFAULT 'bot',
      system_prompt TEXT NOT NULL DEFAULT '',
      description TEXT,
      skills_json TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      protocol TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      models_json TEXT NOT NULL DEFAULT '[]',
      is_default INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'prompt',
      content TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      enabled INTEGER NOT NULL DEFAULT 1,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill_bindings (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      target_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE(skill_id, scope, target_id)
    );
  `)

  migrateAddColumns(db)
}

function migrateAddColumns(db: SqliteDatabase): void {
  const safeAdd = (table: string, column: string, type: string) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    } catch {
      // column already exists
    }
  }
  safeAdd('agents', 'project_id', 'TEXT')
  safeAdd('agents', 'template_id', 'TEXT')
  safeAdd('agents', 'system_prompt', "TEXT DEFAULT ''")
  safeAdd('agents', 'icon', "TEXT DEFAULT 'bot'")
  safeAdd('tasks', 'project_id', 'TEXT')
  safeAdd('rules', 'project_id', 'TEXT')
  safeAdd('sessions', 'project_id', 'TEXT')
  safeAdd('sessions', 'title', 'TEXT')
  safeAdd('sessions', 'updated_at', 'TEXT')
  safeAdd('sessions', 'last_message_at', 'TEXT')
  safeAdd('sessions', 'archived_at', 'TEXT')
  safeAdd('sessions', 'deleted_at', 'TEXT')
}

function migrateLegacyJsonIfNeeded(db: SqliteDatabase, legacyJsonPath?: string): void {
  if (!legacyJsonPath || !existsSync(legacyJsonPath) || hasAnyData(db)) return

  let legacy: StoreData
  try {
    legacy = { ...defaultData(), ...JSON.parse(readFileSync(legacyJsonPath, 'utf-8')) }
  } catch (err) {
    log.warn({ err, path: legacyJsonPath }, '跳过旧 JSON 迁移，无法解析')
    return
  }

  const migrate = db.transaction(() => {
    importAgents(db, legacy.agents)
    importTasks(db, legacy.tasks)
    importSessions(db, legacy.sessions)
    importMessages(db, legacy.messages)
    importSessionEvents(db, legacy.events)
    importRules(db, legacy.rules)
  })
  migrate()

  const backupPath = `${legacyJsonPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  copyFileSync(legacyJsonPath, backupPath)
}

function hasAnyData(db: SqliteDatabase): boolean {
  const row = db.prepare<[], { count: number }>(`
    SELECT
      (SELECT COUNT(*) FROM agents) +
      (SELECT COUNT(*) FROM sessions) +
      (SELECT COUNT(*) FROM messages) +
      (SELECT COUNT(*) FROM session_events) +
      (SELECT COUNT(*) FROM tasks) +
      (SELECT COUNT(*) FROM task_events) +
      (SELECT COUNT(*) FROM rules) AS count
  `).get()
  return (row?.count ?? 0) > 0
}

function defaultData(): StoreData {
  return { agents: {}, sessions: {}, messages: {}, events: {}, tasks: {}, rules: {} }
}

function rowsById(rows: StoreRecord[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const row of rows) {
    if (typeof row.id === 'string') out[row.id] = row
  }
  return out
}

function objectRows(value: unknown): StoreRecord[] {
  if (!value || typeof value !== 'object') return []
  return Object.values(value as Record<string, unknown>).filter(isRecord)
}

function isRecord(value: unknown): value is StoreRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value)
}

function stringOr(value: unknown, fallback: string): string {
  return value == null ? fallback : String(value)
}

function intOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function jsonOrNull(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function jsonOrObject(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return isRecord(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return isRecord(value) ? value : {}
}

function normalizeActionConfig(value: unknown): Record<string, unknown> {
  const config = jsonOrObject(value)
  if (config.assignAgentId !== undefined && config.assign_agent_id === undefined) {
    config.assign_agent_id = config.assignAgentId
    delete config.assignAgentId
  }
  return config
}

function mapRuleRow(row: StoreRecord): StoreRecord {
  const actionConfig = normalizeActionConfig(row.action_config_json ?? row.action_config)
  const { enabled, ...rest } = row
  return { ...rest, action_config: actionConfig, enabled: Boolean(enabled) }
}

function importAgents(db: SqliteDatabase, agents: Record<string, unknown>): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO agents (id, type, name, runtime, status, permission_level, config_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const row of objectRows(agents)) {
    stmt.run(
      stringOr(row.id, ''),
      stringOr(row.type, 'dev'),
      stringOr(row.name, ''),
      stringOr(row.runtime, 'mock'),
      stringOr(row.status, 'standby'),
      intOr(row.permission_level, 3),
      jsonOrNull(row.config_json),
      stringOr(row.created_at, new Date().toISOString()),
    )
  }
}

function importTasks(db: SqliteDatabase, tasks: Record<string, unknown>): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO tasks (id, title, description, source, status, stage, assigned_agent_id, created_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const row of objectRows(tasks)) {
    stmt.run(
      stringOr(row.id, ''),
      stringOr(row.title, ''),
      nullableString(row.description),
      stringOr(row.source, 'human'),
      stringOr(row.status, 'backlog'),
      stringOr(row.stage, ''),
      nullableString(row.assigned_agent_id),
      stringOr(row.created_at, new Date().toISOString()),
      nullableString(row.completed_at),
    )
  }
}

function importSessions(db: SqliteDatabase, sessions: Record<string, unknown>): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO sessions (id, agent_id, task_id, acp_session_id, status, stage, started_at, closed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const row of objectRows(sessions)) {
    stmt.run(
      stringOr(row.id, ''),
      stringOr(row.agent_id, ''),
      nullableString(row.task_id),
      nullableString(row.acp_session_id),
      stringOr(row.status, 'active'),
      stringOr(row.stage, ''),
      stringOr(row.started_at, new Date().toISOString()),
      nullableString(row.closed_at),
    )
  }
}

function importMessages(db: SqliteDatabase, messages: Record<string, unknown[]>): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO messages (id, session_id, role, content, thinking, tool_calls_json, decision_json, attachments_json, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const [sessionId, rows] of Object.entries(messages)) {
    if (!Array.isArray(rows)) continue
    for (const row of rows.filter(isRecord)) {
      stmt.run(
        stringOr(row.id, ''),
        stringOr(row.session_id, sessionId),
        stringOr(row.role, 'agent'),
        stringOr(row.content, ''),
        nullableString(row.thinking),
        jsonOrNull(row.tool_calls_json),
        jsonOrNull(row.decision_json),
        jsonOrNull(row.attachments_json),
        stringOr(row.timestamp, new Date().toISOString()),
      )
    }
  }
}

function importSessionEvents(db: SqliteDatabase, events: Record<string, unknown[]>): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO session_events (id, session_id, agent_id, acp_session_id, message_id, type, role, payload_json, sequence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const [sessionId, rows] of Object.entries(events)) {
    if (!Array.isArray(rows)) continue
    let fallbackSequence = 0
    for (const row of rows.filter(isRecord)) {
      fallbackSequence += 1
      stmt.run(
        stringOr(row.id, ''),
        stringOr(row.session_id, sessionId),
        nullableString(row.agent_id),
        nullableString(row.acp_session_id),
        nullableString(row.message_id),
        stringOr(row.type, 'event'),
        nullableString(row.role),
        stringOr(row.payload_json, '{}'),
        intOr(row.sequence, fallbackSequence),
        stringOr(row.created_at, new Date().toISOString()),
      )
    }
  }
}

function importRules(db: SqliteDatabase, rules: Record<string, unknown>): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO rules (id, name, description, cron, action, action_config_json, enabled, last_run_at, next_run_at, run_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const row of objectRows(rules)) {
    stmt.run(
      stringOr(row.id, ''),
      stringOr(row.name, ''),
      nullableString(row.description),
      stringOr(row.cron, '* * * * *'),
      stringOr(row.action, 'create_task'),
      JSON.stringify(normalizeActionConfig(row.action_config_json ?? row.action_config)),
      row.enabled === false ? 0 : 1,
      nullableString(row.last_run_at),
      nullableString(row.next_run_at),
      intOr(row.run_count, 0),
      stringOr(row.created_at, new Date().toISOString()),
      stringOr(row.updated_at, new Date().toISOString()),
    )
  }
}
