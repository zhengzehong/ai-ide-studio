import { describe, expect, test } from 'vitest'
import { resolve } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { assertToolAllowed, toolDeniedResult } from '../../src/tools/permission-guard.js'
import type { ToolDefinition } from '../../src/tools/types.js'

function baseTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: 'tool-1',
    name: 'script_tool',
    displayName: 'Script Tool',
    description: 'test',
    category: 'custom',
    type: 'script',
    config: { scriptPath: 'tool.mjs', runtime: 'node' },
    permissions: { requiresApproval: false, maxExecutionTime: 1000, networkAccess: false },
    enabled: true,
    isBuiltin: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('tool permission guard', () => {
  test('blocks tools that require approval before execution', () => {
    const result = assertToolAllowed(baseTool({ permissions: { requiresApproval: true, maxExecutionTime: 1000, networkAccess: false } }))
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('requires approval')
    expect(toolDeniedResult(result).isError).toBe(true)
  })

  test('blocks script paths outside allowed paths', () => {
    const allowedRoot = mkdtempSync(resolve(tmpdir(), 'ai-ide-allowed-'))
    const deniedRoot = mkdtempSync(resolve(tmpdir(), 'ai-ide-denied-'))
    try {
      const tool = baseTool({
        config: { scriptPath: resolve(deniedRoot, 'tool.mjs'), runtime: 'node' },
        permissions: { requiresApproval: false, allowedPaths: [allowedRoot], maxExecutionTime: 1000, networkAccess: false },
      })
      const result = assertToolAllowed(tool)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('outside allowed paths')
    } finally {
      rmSync(allowedRoot, { recursive: true, force: true })
      rmSync(deniedRoot, { recursive: true, force: true })
    }
  })

  test('allows script paths inside allowed paths', () => {
    const allowedRoot = mkdtempSync(resolve(tmpdir(), 'ai-ide-allowed-'))
    try {
      const result = assertToolAllowed(baseTool({
        config: { scriptPath: resolve(allowedRoot, 'tool.mjs'), runtime: 'node' },
        permissions: { requiresApproval: false, allowedPaths: [allowedRoot], maxExecutionTime: 1000, networkAccess: false },
      }))
      expect(result.allowed).toBe(true)
    } finally {
      rmSync(allowedRoot, { recursive: true, force: true })
    }
  })
})
