import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { toolStore, toolBindingStore } from '../../src/store/tools.js'
import { resolveToolsAsMcpServers } from '../../src/tools/resolver.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-tool-gateway-resolver-'))
  process.env.DATA_DIR = tmp
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  delete process.env.DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

describe('Tool Gateway resolver', () => {
  test('returns HTTP platform MCP server with token when requested', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ id: 'agent-http', type: 'dev', name: 'Agent HTTP', runtime: 'codex', projectId: project.id })
    const builtin = toolStore.create({
      name: 'core.task.list',
      displayName: '列出任务',
      description: '列出任务',
      category: 'automation',
      type: 'builtin',
      config: { handler: 'core.task.list' },
      permissions: { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false },
      isBuiltin: true,
    })
    toolBindingStore.set(builtin.id, 'global', null)

    const servers = resolveToolsAsMcpServers({
      agentId: agent.id,
      projectId: project.id,
      sessionId: 'sess-http',
      preferHttp: true,
      baseUrl: 'http://127.0.0.1:18800',
    })

    expect(servers).toHaveLength(1)
    expect(servers[0]).toMatchObject({
      type: 'http',
      name: 'ai-ide-tools',
      url: 'http://127.0.0.1:18800/mcp',
    })
    const authorization = servers[0]?.headers?.find(header => header.name === 'Authorization')?.value
    expect(authorization).toMatch(/^Bearer .+/)
  })

  test('merges builtin and script tools into one stable gateway MCP server', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ id: 'agent-a', type: 'dev', name: 'Agent A', runtime: 'codex', projectId: project.id })

    const builtin = toolStore.create({
      name: 'create_task',
      displayName: '创建任务',
      description: '创建任务',
      category: 'automation',
      type: 'builtin',
      config: { handler: 'createTask' },
      permissions: { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false },
      isBuiltin: true,
    })
    const script = toolStore.create({
      name: 'hello_script',
      displayName: 'Hello Script',
      description: 'Run local script',
      category: 'custom',
      type: 'script',
      config: { scriptPath: resolve(tmp, 'hello-tool.mjs'), runtime: 'node', timeout: 5000 },
      inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
      permissions: { requiresApproval: false, allowedPaths: [tmp], maxExecutionTime: 5000, networkAccess: false },
    })
    toolBindingStore.set(builtin.id, 'global', null)
    toolBindingStore.set(script.id, 'project', project.id)

    const servers = resolveToolsAsMcpServers(agent.id, project.id)

    const gateway = servers.find(s => s.name === 'ai-ide-tool-gateway')
    expect(gateway).toBeTruthy()
    expect(gateway?.command).toBe(process.execPath)
    expect(gateway?.args.join(' ')).toContain('tool-gateway')
    expect(gateway?.args.join(' ')).not.toContain('npx')
        expect(gateway?.env).toContainEqual({ name: 'TOOL_IDS', value: `${builtin.id},${script.id}` })
    expect(gateway?.env).toContainEqual({ name: 'PROJECT_ID', value: project.id })
    expect(gateway?.env).toContainEqual({ name: 'AGENT_ID', value: agent.id })
    expect(gateway?.env).toContainEqual({ name: 'DATA_DIR', value: tmp })
  })

  test('keeps external MCP tools as direct servers', () => {
    const external = toolStore.create({
      name: 'browser_mcp',
      displayName: 'Browser',
      description: 'Browser MCP',
      category: 'browser',
      type: 'mcp',
      config: { command: 'node', args: ['browser.js'], env: { FOO: 'bar' }, transport: 'stdio' },
      permissions: { requiresApproval: false, maxExecutionTime: 30_000, networkAccess: true },
    })
    toolBindingStore.set(external.id, 'global', null)

    const servers = resolveToolsAsMcpServers()

    expect(servers).toEqual([
      {
        name: 'browser_mcp',
        command: 'node',
        args: ['browser.js'],
        env: [{ name: 'FOO', value: 'bar' }],
      },
    ])
  })
})

