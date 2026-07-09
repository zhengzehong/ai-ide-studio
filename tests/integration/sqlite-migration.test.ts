import { describe, test, expect, afterAll } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase, getDb } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore, messageStore, eventStore } from '../../src/store/sessions.js'
import { taskStore, taskEventStore } from '../../src/store/tasks.js'
import { ruleStore } from '../../src/store/rules.js'
import { taskStepsMigration } from '../../src/store/migrations/037-task-steps.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-sqlite-'))
afterAll(() => { closeDatabase(); rmSync(tmp, { recursive: true, force: true }) })

const legacyData = {
  agents: {
    'agent-legacy': { id: 'agent-legacy', type: 'dev', name: 'Legacy Agent', runtime: 'mock', status: 'running', permission_level: 2, config_json: JSON.stringify({ provider: 'legacy' }), created_at: '2026-01-01T00:00:00.000Z' },
  },
  sessions: {
    'sess-legacy': { id: 'sess-legacy', agent_id: 'agent-legacy', task_id: 'task-legacy', acp_session_id: 'acp-legacy', status: 'active', stage: '旧阶段', started_at: '2026-01-01T00:01:00.000Z', closed_at: null },
  },
  messages: {
    'sess-legacy': [{ id: 'msg-legacy', session_id: 'sess-legacy', role: 'human', content: '旧消息', thinking: null, tool_calls_json: JSON.stringify([{ id: 'tool-legacy' }]), decision_json: null, attachments_json: JSON.stringify([{ type: 'image', url: 'file://legacy.png' }]), timestamp: '2026-01-01T00:02:00.000Z' }],
  },
  events: {
    'sess-legacy': [{ id: 'evt-legacy', session_id: 'sess-legacy', agent_id: 'agent-legacy', acp_session_id: 'acp-legacy', message_id: 'msg-legacy', type: 'message.chunk', role: 'agent', payload_json: JSON.stringify({ contentDelta: '旧事件' }), sequence: 7, created_at: '2026-01-01T00:03:00.000Z' }],
  },
  tasks: {
    'task-legacy': { id: 'task-legacy', title: '旧任务', description: '旧描述', source: 'human', status: 'executing', stage: '执行中', assigned_agent_id: 'agent-legacy', created_at: '2026-01-01T00:00:30.000Z', completed_at: null },
  },
  rules: {
    'rule-legacy': { id: 'rule-legacy', name: '旧规则', description: '旧规则描述', cron: '*/5 * * * *', action: 'create_task', action_config: { title: '规则任务', description: '来自规则', assign_agent_id: 'agent-legacy' }, enabled: true, last_run_at: null, next_run_at: '2026-01-01T00:05:00.000Z', run_count: 3, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:04:00.000Z' },
  },
}

describe('SQLite 迁移', () => {
  test('创建工具上下文、工具调用审计和 schema_migrations 表', () => {
    closeDatabase()
    initDatabase(resolve(tmp, 'tool-platform.sqlite'))

    const tables = getDb().prepare<[], { name: string }>(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'schema_migrations',
        'tool_contexts',
        'tool_call_audit',
        'model_profiles',
        'global_assistant',
        'agent_session_messages',
        'agent_session_watches',
        'knowledge_bases',
        'knowledge_pages',
        'knowledge_mounts',
        'knowledge_activities',
        'task_attachments',
        'task_steps',
        'task_step_dependencies'
      )
      ORDER BY name
    `).all().map(row => row.name)
    const migrations = getDb().prepare<[], { version: string }>(`
      SELECT version FROM schema_migrations ORDER BY version
    `).all().map(row => row.version)

    expect(tables).toEqual([
      'agent_session_messages',
      'agent_session_watches',
      'global_assistant',
      'knowledge_activities',
      'knowledge_bases',
      'knowledge_mounts',
      'knowledge_pages',
      'model_profiles',
      'schema_migrations',
      'task_attachments',
      'task_step_dependencies',
      'task_steps',
      'tool_call_audit',
      'tool_contexts',
    ])
    const messageColumns = getDb().prepare<[], { name: string }>('PRAGMA table_info(messages)').all().map(row => row.name)
    const eventCenterTables = getDb().prepare<[], { name: string }>(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'event_categories',
        'event_center_events',
        'event_subscriptions',
        'event_consumptions',
        'event_task_links'
      )
      ORDER BY name
    `).all().map(row => row.name)

    expect(migrations).toEqual(['001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '011', '012', '013', '014', '015', '016', '017', '018', '019', '020', '021', '022', '023', '024', '025', '026', '027', '028', '029', '030', '031', '032', '033', '034', '035', '036', '037', '038'])
    expect(messageColumns).toContain('file_changes_json')
    expect(messageColumns).toContain('process_item_count')
    expect(getDb().prepare<[], { name: string }>('PRAGMA table_info(sessions)').all().map(row => row.name)).toContain('last_read_at')
    expect(getDb().prepare<[], { name: string }>('PRAGMA table_info(model_profiles)').all().map(row => row.name)).toContain('is_default')
    expect(getDb().prepare<[], { name: string }>('PRAGMA table_info(agents)').all().map(row => row.name)).toContain('sort_order')
    expect(getDb().prepare<[], { name: string }>('PRAGMA table_info(agents)').all().map(row => row.name)).toContain('hidden_at')
    expect(getDb().prepare<[], { name: string }>('PRAGMA table_info(agents)').all().map(row => row.name)).toContain('avatar_url')
    expect(getDb().prepare<[], { name: string }>('PRAGMA table_info(agent_templates)').all().map(row => row.name)).toContain('avatar_url')
    expect(getDb().prepare<[], { name: string }>('PRAGMA table_info(sessions)').all().map(row => row.name)).toContain('sort_order')
    expect(getDb().prepare<[], { name: string }>('PRAGMA table_info(event_subscriptions)').all().map(row => row.name)).toEqual(expect.arrayContaining(['consumer_session_mode', 'consumer_session_id']))
    expect(getDb().prepare<[], { name: string }>('PRAGMA table_info(event_consumptions)').all().map(row => row.name)).toContain('session_id')
    expect(eventCenterTables).toEqual([
      'event_categories',
      'event_center_events',
      'event_consumptions',
      'event_subscriptions',
      'event_task_links',
    ])
    const categoryColumns = getDb().prepare<[], { name: string }>('PRAGMA table_info(event_categories)').all().map(row => row.name)
    expect(categoryColumns).toContain('project_id')
    expect(categoryColumns).toContain('scope_key')
    expect(getDb().prepare<[], { name: string }>('PRAGMA table_info(projects)').all().map(row => row.name)).toEqual(expect.arrayContaining(['color', 'icon', 'last_visited_at', 'visit_count']))
    expect(getDb().prepare<[], { name: string }>('PRAGMA table_info(sessions)').all().map(row => row.name)).toContain('is_primary')
  })

  test('从 JSON 迁移到 SQLite 并保留所有数据', () => {
    const legacyPath = resolve(tmp, 'ai-ide.db')
    const sqlitePath = resolve(tmp, 'ai-ide.sqlite')
    writeFileSync(legacyPath, JSON.stringify(legacyData, null, 2), 'utf-8')
    initDatabase(sqlitePath)

    expect(existsSync(sqlitePath)).toBe(true)
    expect(readFileSync(sqlitePath).subarray(0, 16).toString('utf-8')).toBe('SQLite format 3\0')
    expect(existsSync(legacyPath)).toBe(true)
    expect(readdirSync(tmp).some(n => n.startsWith('ai-ide.db.backup-') && n.endsWith('.json'))).toBe(true)

    expect(agentStore.get('agent-legacy')?.name).toBe('Legacy Agent')
    expect(taskStore.get('task-legacy')?.title).toBe('旧任务')
    expect(sessionStore.get('sess-legacy')?.stage).toBe('旧阶段')
    expect(messageStore.list('sess-legacy')[0]?.content).toBe('旧消息')
    expect(eventStore.list('sess-legacy')[0]?.sequence).toBe(7)
    expect(ruleStore.get('rule-legacy')?.action_config.assign_agent_id).toBe('agent-legacy')
  })

  test('CRUD 操作和重启后数据持久化', () => {
    const sqlitePath = resolve(tmp, 'ai-ide.sqlite')
    const agent = agentStore.create({ id: 'agent-new', type: 'dev', name: 'New Agent', runtime: 'mock', config: { mode: 'sqlite' } })
    agentStore.updateStatus(agent.id, 'running')
    const task = taskStore.create({ title: '新任务', description: '新描述', assignAgentId: agent.id })
    taskStore.updateStatus(task.id, 'executing', 'SQLite 持久化')
    taskEventStore.append(task.id, { type: 'note', payload: { ok: true } })
    const session = sessionStore.create({ agentId: agent.id, taskId: task.id, acpSessionId: 'acp-new' })
    const message = messageStore.append(session.id, { role: 'human', content: '新消息', attachments: [{ name: 'a.png' }] })
    eventStore.append(session.id, { type: 'message.created', agentId: agent.id, messageId: message.id, role: 'human', payload: { content: '新消息' } })
    ruleStore.create({ name: '新规则', cron: '* * * * *', action: 'create_task', actionConfig: { title: '新规则任务', assignAgentId: agent.id } })

    expect(taskEventStore.list(task.id).some(e => e.type === 'status_changed')).toBe(true)

    closeDatabase()
    initDatabase(sqlitePath)

    expect(agentStore.get(agent.id)?.status).toBe('running')
    expect(taskStore.get(task.id)?.stage).toBe('SQLite 持久化')
    expect(sessionStore.get(session.id)?.acp_session_id).toBe('acp-new')
    expect(messageStore.list(session.id)[0]?.attachments_json).toBe(JSON.stringify([{ name: 'a.png' }]))
  })

  test('传入 .json 路径时自动迁移到同名 .sqlite', () => {
    const customLegacyPath = resolve(tmp, 'custom-legacy.json')
    const customSqlitePath = resolve(tmp, 'custom-legacy.sqlite')
    writeFileSync(customLegacyPath, JSON.stringify({ agents: { 'agent-json-path': { id: 'agent-json-path', type: 'dev', name: 'JSON Path Agent', runtime: 'mock', status: 'standby', permission_level: 3, config_json: null, created_at: '2026-01-02T00:00:00.000Z' } } }), 'utf-8')
    closeDatabase()
    initDatabase(customLegacyPath)
    expect(existsSync(customSqlitePath)).toBe(true)
    expect(agentStore.get('agent-json-path')?.name).toBe('JSON Path Agent')
  })

  test('task-steps migration: status 值迁移 + task_steps / task_step_dependencies 结构', () => {
    const stepsDbPath = resolve(tmp, 'task-steps.sqlite')
    closeDatabase()
    initDatabase(stepsDbPath)
    const db = getDb()

    const legacyStatuses = [
      { id: 'task-backlog', status: 'backlog' },
      { id: 'task-executing', status: 'executing' },
      { id: 'task-needs', status: 'needs_input' },
      { id: 'task-completed', status: 'completed' },
      { id: 'task-cancelled', status: 'cancelled' },
    ]
    const insert = db.prepare('INSERT INTO tasks (id, title, source, status, stage, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    for (const row of legacyStatuses) {
      insert.run(row.id, row.id, 'human', row.status, '', '2026-01-01T00:00:00.000Z')
    }

    taskStepsMigration.up(db)

    const statuses = db.prepare<[], { id: string; status: string }>('SELECT id, status FROM tasks ORDER BY id').all()
    const map = Object.fromEntries(statuses.map(r => [r.id, r.status]))
    expect(map['task-backlog']).toBe('draft')
    expect(map['task-executing']).toBe('running')
    expect(map['task-needs']).toBe('needs_input')
    expect(map['task-completed']).toBe('completed')
    expect(map['task-cancelled']).toBe('cancelled')

    const stepColumns = db.prepare<[], { name: string }>('PRAGMA table_info(task_steps)').all().map(r => r.name)
    expect(stepColumns).toEqual(expect.arrayContaining([
      'id', 'task_id', 'title', 'description', 'status', 'assignee_agent_id',
      'session_id', 'current_stage', 'sort_order', 'created_at', 'updated_at',
    ]))
    const stepIndexes = db.prepare<[], { name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'task_steps'`).all().map(r => r.name)
    expect(stepIndexes).toEqual(expect.arrayContaining([
      'idx_task_steps_task_id', 'idx_task_steps_status', 'idx_task_steps_assignee',
    ]))

    const depColumns = db.prepare<[], { name: string }>('PRAGMA table_info(task_step_dependencies)').all().map(r => r.name)
    expect(depColumns).toEqual(expect.arrayContaining([
      'step_id', 'depends_on_step_id', 'task_id', 'created_at',
    ]))
    const depIndexes = db.prepare<[], { name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'task_step_dependencies'`).all().map(r => r.name)
    expect(depIndexes).toEqual(expect.arrayContaining([
      'idx_step_deps_step', 'idx_step_deps_depends_on', 'idx_step_deps_task',
    ]))
  })
})
