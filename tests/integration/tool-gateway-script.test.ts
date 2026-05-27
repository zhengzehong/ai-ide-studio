import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { toolStore, toolBindingStore } from '../../src/store/tools.js'
import { buildGatewayTools } from '../../src/tools/tool-gateway.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-tool-gateway-'))
  process.env.DATA_DIR = tmp
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  delete process.env.DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

describe('Tool Gateway execution', () => {
  test('loads selected builtin and script tools by TOOL_IDS and executes script tools', async () => {
    const script = resolve(tmp, 'hello.mjs')
    writeFileSync(script, "export default (input) => ({ ok: true, name: input.name })\n", 'utf-8')
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
    const scriptTool = toolStore.create({
      name: 'hello_script',
      displayName: 'Hello Script',
      description: 'Script tool',
      category: 'custom',
      type: 'script',
      config: { scriptPath: script, runtime: 'node', timeout: 1000 },
      inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
      permissions: { requiresApproval: false, allowedPaths: [tmp], maxExecutionTime: 1000, networkAccess: false },
    })
    toolBindingStore.set(builtin.id, 'global', null)
    toolBindingStore.set(scriptTool.id, 'global', null)

    const tools = buildGatewayTools({ toolIds: [builtin.id, scriptTool.id], projectId: 'p1', agentId: 'a1', workDir: tmp })

    expect(tools.map(t => t.name)).toEqual(['create_task', 'hello_script'])
    const result = await tools.find(t => t.name === 'hello_script')?.execute({ name: 'Ada' })
    expect(result).toEqual({ content: [{ type: 'text', text: JSON.stringify({ ok: true, name: 'Ada' }, null, 2) }] })
  })

  test('returns a clear error result instead of executing tools that require approval', async () => {
    const script = resolve(tmp, 'blocked.mjs')
    writeFileSync(script, "export default () => 'should not run'\n", 'utf-8')
    const tool = toolStore.create({
      name: 'blocked_script',
      displayName: 'Blocked',
      description: 'Blocked script',
      category: 'custom',
      type: 'script',
      config: { scriptPath: script, runtime: 'node', timeout: 1000 },
      permissions: { requiresApproval: true, allowedPaths: [tmp], maxExecutionTime: 1000, networkAccess: false },
    })
    toolBindingStore.set(tool.id, 'global', null)

    const tools = buildGatewayTools({ toolIds: [tool.id], workDir: tmp })
    const result = await tools[0]?.execute({})

    expect(result?.isError).toBe(true)
    expect(result?.content[0]?.text).toContain('requires approval')
  })
})
