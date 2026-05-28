import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { toolStore, toolBindingStore } from '../../src/store/tools.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-tool-gateway-mcp-'))
  process.env.DATA_DIR = tmp
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  delete process.env.DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

describe('Tool Gateway MCP server', () => {
  test('exposes selected script tools through MCP stdio and executes them', async () => {
    const script = resolve(tmp, 'hello.mjs')
    writeFileSync(script, "export default (input) => `hello ${input.name}`\n", 'utf-8')
    const tool = toolStore.create({
      name: 'hello_script',
      displayName: 'Hello Script',
      description: 'Script tool',
      category: 'custom',
      type: 'script',
      config: { scriptPath: script, runtime: 'node', timeout: 1000 },
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      permissions: { requiresApproval: false, allowedPaths: [tmp], maxExecutionTime: 1000, networkAccess: false },
    })
    toolBindingStore.set(tool.id, 'global', null)

    const client = new Client({ name: 'gateway-test', version: '0.0.0' })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', resolve(process.cwd(), 'src/tools/mcp-server.ts')],
      env: { ...process.env, DATA_DIR: tmp, TOOL_IDS: tool.id },
      stderr: 'pipe',
      cwd: process.cwd(),
    })

    await client.connect(transport)
    try {
      const listed = await client.listTools()
      expect(listed.tools.map(t => t.name)).toEqual(['hello_script'])

      const result = await client.callTool({ name: 'hello_script', arguments: { name: 'Ada' } }, CallToolResultSchema)
      expect(result).toMatchObject({ content: [{ type: 'text', text: 'hello Ada' }] })
    } finally {
      await client.close()
    }
  })
})
