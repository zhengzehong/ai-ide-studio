import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { startGateway } from '../../src/gateway/server.js'
import { toolStore, toolBindingStore } from '../../src/store/tools.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { createToolContext } from '../../src/tools/registry/context-registry.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import type { ToolHandler } from '../../src/tools/types.js'
import type { Server } from 'node:http'
import type { WebSocketServer } from 'ws'

let tmp: string
let server: Server | undefined
let wss: WebSocketServer | undefined

type GatewayHandle = Awaited<ReturnType<typeof startGateway>>

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-http-mcp-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(async () => {
  await closeGateway()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('HTTP MCP tool platform', () => {
  test('filters list by token and rejects calls to invisible methods', async () => {
    await startTestGateway()
    seedBuiltin('core.task.list', listHandler)
    seedBuiltin('core.task.create', createHandler)

    const tokenA = createToolContext({ sessionId: 'sess-a', agentId: 'agent-a', visibleTools: ['core.task.list'] }).token
    const agent = agentStore.create({ name: 'Caller', type: 'coder', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    const tokenB = createToolContext({ sessionId: session.id, agentId: agent.id, visibleTools: ['core.task.list', 'core.task.create'] }).token

    const clientA = await connectClient(tokenA)
    const clientB = await connectClient(tokenB)

    try {
      expect((await clientA.listTools()).tools.map(tool => tool.name)).toEqual(['core.task.list'])
      expect((await clientB.listTools()).tools.map(tool => tool.name).sort()).toEqual(['core.task.create', 'core.task.list'])

      const denied = await clientA.callTool({ name: 'core.task.create', arguments: { title: 'A' } }, CallToolResultSchema)
      expect(denied.isError).toBe(true)
      expect(denied.content[0]?.type).toBe('text')

      const created = await clientB.callTool({ name: 'core.task.create', arguments: { title: 'B' } }, CallToolResultSchema)
      expect(created.content[0]?.type).toBe('text')
      expect(created.content[0]?.text).toContain('"title": "B"')
    } finally {
      await clientA.close()
      await clientB.close()
    }
  })

  test('keeps MCP bearer-token auth separate from local access token guard', async () => {
    await startTestGateway('local-secret')
    seedBuiltin('core.task.list', listHandler)
    const token = createToolContext({ sessionId: 'sess-local-token', agentId: 'agent-a', visibleTools: ['core.task.list'] }).token

    const health = await fetch(`${baseUrl()}/health`)
    expect(health.status).toBe(401)

    const workspace = await fetch(`${baseUrl()}/workspace`)
    expect(workspace.status).not.toBe(401)

    const client = await connectClient(token)
    try {
      expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['core.task.list'])
    } finally {
      await client.close()
    }
  })

  test('presents project-relative and arbitrary absolute files through HTTP MCP', async () => {
    const workspace = resolve(tmp, 'project-workspace')
    const relativeFile = resolve(workspace, 'docs', 'report.md')
    const outsideFile = resolve(tmp, 'outside.md')
    mkdirSync(resolve(workspace, 'docs'), { recursive: true })
    writeFileSync(relativeFile, '# Relative', 'utf-8')
    writeFileSync(outsideFile, '# Absolute', 'utf-8')
    const project = projectStore.create({ name: 'Files project', workDir: workspace })
    const handler = getHandler('files.present')
    expect(handler).toBeDefined()
    if (!handler) return
    seedBuiltin('files.present', handler)
    await startTestGateway()
    const token = createToolContext({
      sessionId: 'sess-files',
      agentId: 'agent-files',
      projectId: project.id,
      visibleTools: ['files.present'],
    }).token
    const client = await connectClient(token)

    try {
      const relativeResult = await client.callTool({
        name: 'files.present',
        arguments: { files: [{ path: 'docs/report.md' }] },
      }, CallToolResultSchema)
      expect(relativeResult.isError).not.toBe(true)
      expect(relativeResult.content[0]?.text).toContain('docs/report.md')

      const absoluteResult = await client.callTool({
        name: 'files.present',
        arguments: { files: [{ path: outsideFile }] },
      }, CallToolResultSchema)
      expect(absoluteResult.isError).not.toBe(true)
      expect(absoluteResult.content[0]?.text).toContain(outsideFile.replace(/\\/g, '\\\\'))
    } finally {
      await client.close()
    }
  })
})

const listHandler: ToolHandler = {
  name: 'core.task.list',
  description: 'list tasks',
  inputSchema: { type: 'object', properties: {} },
  async execute() {
    return { content: [{ type: 'text', text: '[]' }] }
  },
}

const createHandler: ToolHandler = {
  name: 'core.task.create',
  description: 'create task',
  inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  async execute(input) {
    return { content: [{ type: 'text', text: `created ${String(input.title)}` }] }
  },
}

async function startTestGateway(localToken?: string): Promise<void> {
  const handle: GatewayHandle = await startGateway({ port: 0, dataDir: tmp, localToken })
  server = handle.server
  wss = handle.wss
}

async function closeGateway(): Promise<void> {
  if (wss) {
    wss.close()
    wss = undefined
  }
  if (server) {
    await new Promise<void>((resolveClose) => server?.close(() => resolveClose()))
    server = undefined
  }
}

function baseUrl(): string {
  const address = server?.address()
  if (!address || typeof address === 'string') throw new Error('test server not listening')
  return `http://127.0.0.1:${address.port}`
}

async function connectClient(token: string): Promise<Client> {
  const client = new Client({ name: 'http-mcp-test', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl()}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  await client.connect(transport)
  return client
}

function seedBuiltin(name: string, handler: ToolHandler): void {
  const tool = toolStore.create({
    name,
    displayName: name,
    description: handler.description,
    category: 'automation',
    type: 'builtin',
    config: { handler: name },
    inputSchema: handler.inputSchema,
    permissions: { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false },
    isBuiltin: true,
  })
  toolBindingStore.set(tool.id, 'global', null)
}
