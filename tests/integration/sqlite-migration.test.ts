import { describe, test, expect, afterAll } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase, getDb } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore, messageStore, eventStore } from '../../src/store/sessions.js'
import { taskStore, taskEventStore } from '../../src/store/tasks.js'
import { ruleStore } from '../../src/store/rules.js'

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
      WHERE type = 'table' AND name IN ('schema_migrations', 'tool_contexts', 'tool_call_audit', 'model_profiles')
      ORDER BY name
    `).all().map(row => row.name)
    const migrations = getDb().prepare<[], { version: string }>(`
      SELECT version FROM schema_migrations ORDER BY version
    `).all().map(row => row.version)

    expect(tables).toEqual(['model_profiles', 'schema_migrations', 'tool_call_audit', 'tool_contexts'])
    expect(migrations).toEqual(['001', '002', '003', '004', '005', '006'])
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
})
