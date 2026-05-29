import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase, getDb } from '../../src/store/db.js'
import { toolStore, toolBindingStore } from '../../src/store/tools.js'
import { createToolContext } from '../../src/tools/registry/context-registry.js'
import { seedBuiltinTools } from '../../src/tools/seed.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-tool-seed-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('builtin tool seed synchronization', () => {
  test('adds core tools even when older builtin rows already exist', () => {
    for (const name of ['create_task', 'create_schedule', 'search_files', 'get_project_info', 'list_agents', 'http_fetch']) {
      const tool = toolStore.create({
        name,
        displayName: name,
        description: name,
        category: 'automation',
        type: 'builtin',
        config: { handler: legacyHandlerName(name) },
        inputSchema: { type: 'object', properties: {} },
        permissions: { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false },
        isBuiltin: true,
      })
      toolBindingStore.set(tool.id, 'global', null)
    }

    seedBuiltinTools()

    const names = getDb().prepare<[], { name: string }>('SELECT name FROM tools ORDER BY name').all().map(row => row.name)
    expect(names).toEqual([
      'core.agent.create',
      'core.agent.get',
      'core.agent.list',
      'core.project.create',
      'core.project.get',
      'core.project.list',
      'core.session.create',
      'core.session.get',
      'core.session.list',
      'core.task.create',
      'core.task.list',
      'create_schedule',
      'create_task',
      'team.create',
      'team.get',
      'team.list',
      'team.mailbox.list',
      'team.mailbox.send',
      'team.member.list',
      'team.member.message',
      'team.member.spawn',
      'team.task.create',
      'team.task.list',
      'team.task.update',
      'team.template.describe',
      'team.template.list',
      'team.update',
    ])

    const globalBindings = getDb().prepare<[], { name: string }>(`
      SELECT tools.name FROM tools
      JOIN tool_bindings ON tool_bindings.tool_id = tools.id
      WHERE tool_bindings.scope = 'global' AND tool_bindings.enabled = 1
      ORDER BY tools.name
    `).all().map(row => row.name)
    expect(globalBindings).toEqual(names)
  })

  test('removes obsolete broken tools and revokes stale tool contexts', () => {
    const staleTool = toolStore.create({
      name: 'get_project_info',
      displayName: 'get_project_info',
      description: 'stale',
      category: 'data',
      type: 'builtin',
      config: { handler: 'getProjectInfo' },
      inputSchema: { type: 'object', properties: {} },
      permissions: { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false },
      isBuiltin: true,
    })
    toolBindingStore.set(staleTool.id, 'global', null)
    createToolContext({ sessionId: 'sess-stale', agentId: 'agent-stale', visibleTools: ['create_task', 'get_project_info'] })

    seedBuiltinTools()

    expect(toolStore.getByName('get_project_info')).toBeUndefined()
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM tool_bindings WHERE tool_id = ?').get(staleTool.id)).toEqual({ count: 0 })
    expect(getDb().prepare<[], { revoked_at: string | null }>('SELECT revoked_at FROM tool_contexts WHERE session_id = ?').get('sess-stale')?.revoked_at).toBeTruthy()
  })
})

function legacyHandlerName(name: string): string {
  const handlers: Record<string, string> = {
    create_task: 'createTask',
    create_schedule: 'createSchedule',
    search_files: 'searchFiles',
    get_project_info: 'getProjectInfo',
    list_agents: 'listAgents',
    http_fetch: 'httpFetch',
  }
  return handlers[name] ?? name
}
