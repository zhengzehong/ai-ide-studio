import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase, getDb } from '../../src/store/db.js'
import { toolStore, toolBindingStore } from '../../src/store/tools.js'
import { executeRuntimeTool, listRuntimeTools } from '../../src/tools/runtime/tool-runtime.js'
import type { ToolRuntimeContext } from '../../src/tools/runtime/tool-runtime.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-tool-runtime-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('tool runtime', () => {
  test('lists only tools visible in the runtime context', () => {
    const visible = createScriptTool('custom.visible')
    const hidden = createScriptTool('custom.hidden')
    toolBindingStore.set(visible.id, 'global', null)
    toolBindingStore.set(hidden.id, 'global', null)

    expect(listRuntimeTools(context(['custom.visible'])).map(tool => tool.name)).toEqual(['custom.visible'])
  })

  test('rejects invisible tool calls and writes denied audit', async () => {
    createScriptTool('custom.denied')

    const result = await executeRuntimeTool('custom.denied', {}, context([]))

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('不可见')
    const audit = getDb().prepare<[], { status: string; tool_name: string }>('SELECT status, tool_name FROM tool_call_audit').all()
    expect(audit).toEqual([{ status: 'denied', tool_name: 'custom.denied' }])
  })

  test('runs visible script tools and writes succeeded audit', async () => {
    const script = resolve(tmp, 'hello.mjs')
    writeFileSync(script, "export default (input) => `hello ${input.name}`\n", 'utf-8')
    const tool = toolStore.create({
      name: 'custom.hello',
      displayName: 'Hello',
      description: 'Hello script',
      category: 'custom',
      type: 'script',
      config: { scriptPath: script, runtime: 'node', timeout: 1000 },
      inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
      permissions: { requiresApproval: false, allowedPaths: [tmp], maxExecutionTime: 1000, networkAccess: false },
    })
    toolBindingStore.set(tool.id, 'global', null)

    const result = await executeRuntimeTool('custom.hello', { name: 'Ada' }, context(['custom.hello']))

    expect(result).toMatchObject({ content: [{ type: 'text', text: 'hello Ada' }] })
    const audit = getDb().prepare<[], { status: string; tool_name: string }>('SELECT status, tool_name FROM tool_call_audit').all()
    expect(audit).toEqual([{ status: 'succeeded', tool_name: 'custom.hello' }])
  })
})

function context(visibleTools: string[]): ToolRuntimeContext {
  return {
    sessionId: 'sess-runtime',
    agentId: 'agent-runtime',
    projectId: 'proj-runtime',
    workDir: tmp,
    visibleTools,
  }
}

function createScriptTool(name: string) {
  return toolStore.create({
    name,
    displayName: name,
    description: name,
    category: 'custom',
    type: 'script',
    config: { scriptPath: resolve(tmp, `${name}.mjs`), runtime: 'node', timeout: 1000 },
    inputSchema: { type: 'object', properties: {} },
    permissions: { requiresApproval: false, allowedPaths: [tmp], maxExecutionTime: 1000, networkAccess: false },
  })
}
