import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase, getDb } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { toolStore, toolBindingStore } from '../../src/store/tools.js'
import { resolveVisiblePlatformTools } from '../../src/tools/registry/visibility-resolver.js'
import { resolveToolsForSession } from '../../src/tools/resolver.js'
import { seedBuiltinTools } from '../../src/tools/seed.js'
import { sessionStore } from '../../src/store/sessions.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-tool-visibility-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('tool visibility resolver', () => {
  test('combines global, project, and agent method bindings', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ type: 'dev', name: 'A', runtime: 'mock', projectId: project.id })
    const globalTool = createBuiltin('core.task.list')
    const projectTool = createBuiltin('core.project.list')
    const agentTool = createScript('custom.hello')

    toolBindingStore.set(globalTool.id, 'global', null)
    toolBindingStore.set(projectTool.id, 'project', project.id)
    toolBindingStore.set(agentTool.id, 'agent', agent.id)

    expect(
      resolveVisiblePlatformTools({ agentId: agent.id, projectId: project.id })
        .map((t) => t.definition.name)
        .sort(),
    ).toEqual(['core.project.list', 'core.task.list', 'custom.hello'])
  })

  test('disabled agent binding hides a globally visible method', () => {
    const agent = agentStore.create({ type: 'dev', name: 'A', runtime: 'mock' })
    const tool = createBuiltin('core.task.create')
    toolBindingStore.set(tool.id, 'global', null)
    toolBindingStore.set(tool.id, 'agent', agent.id)
    getDb()
      .prepare('UPDATE tool_bindings SET enabled = 0 WHERE tool_id = ? AND scope = ? AND target_id = ?')
      .run(tool.id, 'agent', agent.id)

    expect(resolveVisiblePlatformTools({ agentId: agent.id }).map((t) => t.definition.name)).toEqual([])
  })

  test('external MCP tools are not included in platform visible methods', () => {
    const external = toolStore.create({
      name: 'browser_mcp',
      displayName: 'Browser',
      description: 'Browser MCP',
      category: 'browser',
      type: 'mcp',
      config: { command: 'node', args: ['browser.js'], transport: 'stdio' },
      permissions: { requiresApproval: false, maxExecutionTime: 30_000, networkAccess: true },
    })
    toolBindingStore.set(external.id, 'global', null)

    expect(resolveVisiblePlatformTools({}).map((t) => t.definition.name)).toEqual([])
  })

  test('hides team tools even when explicitly bound to an agent', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ type: 'dev', name: 'A', runtime: 'mock', projectId: project.id })
    seedBuiltinTools()

    expect(
      resolveVisiblePlatformTools({ agentId: agent.id, projectId: project.id }).map((t) => t.definition.name),
    ).not.toContain('team.create')

    const teamCreate = toolStore.getByName('team.create')
    if (!teamCreate) throw new Error('team.create missing')
    toolBindingStore.set(teamCreate.id, 'agent', agent.id)

    expect(resolveVisiblePlatformTools({ agentId: agent.id, projectId: project.id }).map((t) => t.definition.name))
      .not.toContain('team.create')
  })

  test('exposes secretary.report only inside secretary Sessions', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ type: 'pm', name: 'A', runtime: 'mock', projectId: project.id })
    seedBuiltinTools()
    const conversation = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const runtime = sessionStore.create({ agentId: agent.id, projectId: project.id, purpose: 'secretary_runtime' })

    expect(resolveVisiblePlatformTools({ agentId: agent.id, projectId: project.id, sessionId: conversation.id })
      .map((tool) => tool.definition.name)).not.toContain('secretary.report')
    expect(resolveVisiblePlatformTools({ agentId: agent.id, projectId: project.id, sessionId: runtime.id })
      .map((tool) => tool.definition.name)).toContain('secretary.report')
    expect(resolveToolsForSession(agent.id, project.id, conversation.id)
      .map((tool) => tool.definition.name)).not.toContain('secretary.report')
    expect(resolveToolsForSession(agent.id, project.id, runtime.id)
      .map((tool) => tool.definition.name)).toContain('secretary.report')
  })
})

function createBuiltin(name: string) {
  return toolStore.create({
    name,
    displayName: name,
    description: name,
    category: 'automation',
    type: 'builtin',
    config: { handler: name },
    permissions: { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false },
    isBuiltin: true,
  })
}

function createScript(name: string) {
  return toolStore.create({
    name,
    displayName: name,
    description: name,
    category: 'custom',
    type: 'script',
    config: { scriptPath: resolve(tmp, 'hello.mjs'), runtime: 'node', timeout: 1000 },
    inputSchema: { type: 'object', properties: {} },
    permissions: { requiresApproval: false, allowedPaths: [tmp], maxExecutionTime: 1000, networkAccess: false },
  })
}
