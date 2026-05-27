import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { runScriptTool } from '../../src/tools/script-runner.js'
import type { ToolDefinition } from '../../src/tools/types.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-script-runner-'))
})

afterEach(() => rmSync(tmp, { recursive: true, force: true }))

function scriptTool(scriptPath: string, timeout = 1000): ToolDefinition {
  return {
    id: 'tool-script',
    name: 'hello_script',
    displayName: 'Hello Script',
    description: 'test',
    category: 'custom',
    type: 'script',
    config: { scriptPath, runtime: 'node', timeout },
    inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
    permissions: { requiresApproval: false, allowedPaths: [tmp], maxExecutionTime: timeout, networkAccess: false },
    enabled: true,
    isBuiltin: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

describe('script runner', () => {
  test('executes ESM default function scripts and wraps text output as MCP content', async () => {
    const script = resolve(tmp, 'hello.mjs')
    writeFileSync(script, "export default async function(input) { return `hello ${input.name}` }\n", 'utf-8')

    const result = await runScriptTool(scriptTool(script), { name: 'Ada' }, { projectId: 'p1', workDir: tmp })

    expect(result).toEqual({ content: [{ type: 'text', text: 'hello Ada' }] })
  })

  test('executes scripts that export execute and preserves ToolHandlerResult shape', async () => {
    const script = resolve(tmp, 'object.mjs')
    writeFileSync(script, "export const execute = async (input, context) => ({ content: [{ type: 'text', text: `${context.projectId}:${input.name}` }] })\n", 'utf-8')

    const result = await runScriptTool(scriptTool(script), { name: 'Lin' }, { projectId: 'proj', workDir: tmp })

    expect(result).toEqual({ content: [{ type: 'text', text: 'proj:Lin' }] })
  })

  test('returns an MCP error result when script execution times out', async () => {
    const script = resolve(tmp, 'slow.mjs')
    writeFileSync(script, "export default async function() { await new Promise(r => setTimeout(r, 200)); return 'late' }\n", 'utf-8')

    const result = await runScriptTool(scriptTool(script, 20), {}, { workDir: tmp })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('timed out')
  })

  test('rejects missing script files as MCP error results', async () => {
    const result = await runScriptTool(scriptTool(resolve(tmp, 'missing.mjs')), {}, { workDir: tmp })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('not found')
  })
})
