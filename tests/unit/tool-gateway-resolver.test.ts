import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { teamMemberStore, teamStore } from '../../src/store/teams.js'
import { toolStore, toolBindingStore } from '../../src/store/tools.js'
import { validateToolToken } from '../../src/tools/registry/context-registry.js'
import { resolveToolsAsMcpServers } from '../../src/tools/resolver.js'
import { listRuntimeTools } from '../../src/tools/runtime/tool-runtime.js'

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

describe('runtime tool schema context boundary', () => {
  test('hides system-owned context fields from model-visible schemas', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({
      id: 'agent-schema',
      type: 'leader',
      name: 'Leader',
      runtime: 'claude',
      projectId: project.id,
    })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const team = teamStore.create({ projectId: project.id, name: 'Alpha' })
    const member = teamMemberStore.create({
      teamId: team.id,
      projectId: project.id,
      agentId: agent.id,
      sessionId: session.id,
      name: agent.name,
      role: 'member',
    })
    const names = ['team.create', 'team.mailbox.send', 'team.task.update', 'core.task.create']
    for (const name of names) {
      const tool = toolStore.create({
        name,
        displayName: name,
        description: name,
        category: 'automation',
        type: 'builtin',
        config: { handler: name },
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string' },
            teamId: { type: 'string' },
            fromMemberId: { type: 'string' },
            leaderAgentId: { type: 'string' },
            teamMemberId: { type: 'string' },
            assigneeMemberId: { type: 'string' },
            title: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['projectId', 'teamId', 'fromMemberId', 'title'],
        },
        permissions: { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false },
        isBuiltin: true,
      })
      toolBindingStore.set(tool.id, 'agent', agent.id)
    }

    const runtimeTools = listRuntimeTools({
      sessionId: session.id,
      agentId: agent.id,
      projectId: project.id,
      teamId: team.id,
      teamMemberId: member.id,
      visibleTools: names,
    })

    for (const tool of runtimeTools) {
      const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] }
      expect(schema.properties).not.toHaveProperty('projectId')
      expect(schema.properties).not.toHaveProperty('teamId')
      expect(schema.properties).not.toHaveProperty('fromMemberId')
      expect(schema.properties).not.toHaveProperty('leaderAgentId')
      expect(schema.properties).not.toHaveProperty('teamMemberId')
      expect(schema.required ?? []).not.toEqual(expect.arrayContaining(['projectId', 'teamId', 'fromMemberId']))
    }
    expect(
      (
        runtimeTools.find((tool) => tool.name === 'team.task.update')?.inputSchema as {
          properties?: Record<string, unknown>
        }
      ).properties,
    ).not.toHaveProperty('assigneeMemberId')
  })

  test('keeps explicit sessionId fields visible for target-session tools', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({
      id: 'agent-session-schema',
      type: 'dev',
      name: 'Session Schema',
      runtime: 'codex',
      projectId: project.id,
    })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const names = ['agent.watch.create', 'agent.session.messages', 'core.session.get']
    for (const name of names) {
      const tool = toolStore.create({
        name,
        displayName: name,
        description: name,
        category: 'data',
        type: 'builtin',
        config: { handler: name },
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['sessionId'],
        },
        permissions: { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false },
        isBuiltin: true,
      })
      toolBindingStore.set(tool.id, 'agent', agent.id)
    }

    const runtimeTools = listRuntimeTools({
      sessionId: session.id,
      agentId: agent.id,
      projectId: project.id,
      visibleTools: names,
    })

    for (const tool of runtimeTools) {
      const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] }
      expect(schema.properties).toHaveProperty('sessionId')
      expect(schema.required).toEqual(expect.arrayContaining(['sessionId']))
    }
  })

  test('keeps core.project.get projectId visible while hiding current projectId on scoped tools', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({
      id: 'agent-project-schema',
      type: 'dev',
      name: 'Project Schema',
      runtime: 'codex',
      projectId: project.id,
    })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    for (const name of ['core.project.get', 'core.task.list', 'core.kb.list']) {
      const tool = toolStore.create({
        name,
        displayName: name,
        description: name,
        category: 'data',
        type: 'builtin',
        config: { handler: name },
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string' },
            status: { type: 'string' },
          },
          required: ['projectId'],
        },
        permissions: { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false },
        isBuiltin: true,
      })
      toolBindingStore.set(tool.id, 'agent', agent.id)
    }

    const runtimeTools = listRuntimeTools({
      sessionId: session.id,
      agentId: agent.id,
      projectId: project.id,
      visibleTools: ['core.project.get', 'core.task.list', 'core.kb.list'],
    })
    const schemas = Object.fromEntries(
      runtimeTools.map((tool) => [
        tool.name,
        tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] },
      ]),
    )

    expect(schemas['core.project.get']?.properties).toHaveProperty('projectId')
    expect(schemas['core.project.get']?.required).toEqual(expect.arrayContaining(['projectId']))
    expect(schemas['core.task.list']?.properties).not.toHaveProperty('projectId')
    expect(schemas['core.task.list']?.required ?? []).not.toEqual(expect.arrayContaining(['projectId']))
    expect(schemas['core.kb.list']?.properties).not.toHaveProperty('projectId')
    expect(schemas['core.kb.list']?.required ?? []).not.toEqual(expect.arrayContaining(['projectId']))
  })
})

describe('Tool Gateway resolver', () => {
  test('returns HTTP platform MCP server with token when requested', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({
      id: 'agent-http',
      type: 'dev',
      name: 'Agent HTTP',
      runtime: 'codex',
      projectId: project.id,
    })
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
    const authorization = servers[0]?.headers?.find((header) => header.name === 'Authorization')?.value
    expect(authorization).toMatch(/^Bearer .+/)
  })

  test('injects team context into HTTP tool tokens from member session', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({
      id: 'agent-team',
      type: 'dev',
      name: 'Agent Team',
      runtime: 'codex',
      projectId: project.id,
    })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const team = teamStore.create({ projectId: project.id, name: 'Alpha' })
    const member = teamMemberStore.create({
      teamId: team.id,
      projectId: project.id,
      agentId: agent.id,
      sessionId: session.id,
      name: agent.name,
      role: 'member',
    })
    const builtin = toolStore.create({
      name: 'team.mailbox.send',
      displayName: '发送 Team 留言',
      description: '发送 Team 留言',
      category: 'automation',
      type: 'builtin',
      config: { handler: 'team.mailbox.send' },
      permissions: { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false },
      isBuiltin: true,
    })
    toolBindingStore.set(builtin.id, 'global', null)

    const servers = resolveToolsAsMcpServers({
      agentId: agent.id,
      projectId: project.id,
      sessionId: session.id,
      preferHttp: true,
    })
    const authorization = servers[0]?.headers?.find((header) => header.name === 'Authorization')?.value
    const token = authorization?.replace(/^Bearer\s+/i, '') ?? ''

    expect(validateToolToken(token)).toMatchObject({
      teamId: team.id,
      teamMemberId: member.id,
    })
  })

  test('injects team context into stdio gateway env from member session', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({
      id: 'agent-team-stdio',
      type: 'dev',
      name: 'Agent Team',
      runtime: 'codex',
      projectId: project.id,
    })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const team = teamStore.create({ projectId: project.id, name: 'Alpha' })
    const member = teamMemberStore.create({
      teamId: team.id,
      projectId: project.id,
      agentId: agent.id,
      sessionId: session.id,
      name: agent.name,
      role: 'member',
    })
    const builtin = toolStore.create({
      name: 'team.mailbox.send',
      displayName: '发送 Team 留言',
      description: '发送 Team 留言',
      category: 'automation',
      type: 'builtin',
      config: { handler: 'team.mailbox.send' },
      permissions: { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false },
      isBuiltin: true,
    })
    toolBindingStore.set(builtin.id, 'global', null)

    const servers = resolveToolsAsMcpServers({
      agentId: agent.id,
      projectId: project.id,
      sessionId: session.id,
      preferHttp: false,
    })
    const gateway = servers.find((s) => s.name === 'ai-ide-tool-gateway')

    expect(gateway?.env).toContainEqual({ name: 'TEAM_ID', value: team.id })
    expect(gateway?.env).toContainEqual({ name: 'TEAM_MEMBER_ID', value: member.id })
    expect(gateway?.env).toContainEqual({ name: 'SESSION_ID', value: session.id })
  })

  test('disabled agent binding hides inherited platform tool in stdio gateway config', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({
      id: 'agent-hidden',
      type: 'dev',
      name: 'Agent Hidden',
      runtime: 'codex',
      projectId: project.id,
    })
    const builtin = toolStore.create({
      name: 'team.create',
      displayName: '创建 Team',
      description: '创建 Team',
      category: 'automation',
      type: 'builtin',
      config: { handler: 'team.create' },
      permissions: { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false },
      isBuiltin: true,
    })
    toolBindingStore.set(builtin.id, 'project', project.id)
    toolBindingStore.setEnabled(builtin.id, 'agent', agent.id, false)

    const servers = resolveToolsAsMcpServers({
      agentId: agent.id,
      projectId: project.id,
      sessionId: 'sess-hidden',
      preferHttp: false,
    })

    expect(servers.find((s) => s.name === 'ai-ide-tool-gateway')).toBeUndefined()
  })

  test('merges builtin and script tools into one stable gateway MCP server', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({
      id: 'agent-a',
      type: 'dev',
      name: 'Agent A',
      runtime: 'codex',
      projectId: project.id,
    })

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

    const gateway = servers.find((s) => s.name === 'ai-ide-tool-gateway')
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
