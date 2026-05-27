import { describe, expect, test } from 'vitest'
import { getRuntimeCommand } from '../../src/acp/runtime-registry.js'

describe('runtime registry', () => {
  test('prefers local installed ACP adapter over npx fallback', () => {
    const command = getRuntimeCommand('codex')
    expect(command).toBeTruthy()
    expect(command?.args).toEqual([])
    expect(command?.cmd).toContain('codex-acp')
    expect(command?.cmd).not.toMatch(/\bnpx(\.cmd)?$/)
  })

  test('supports environment command override', () => {
    const previous = process.env.AI_IDE_CLAUDE_ACP_CMD
    process.env.AI_IDE_CLAUDE_ACP_CMD = 'custom-claude-acp --flag value'
    try {
      expect(getRuntimeCommand('claude')).toEqual({ cmd: 'custom-claude-acp', args: ['--flag', 'value'] })
    } finally {
      if (previous === undefined) delete process.env.AI_IDE_CLAUDE_ACP_CMD
      else process.env.AI_IDE_CLAUDE_ACP_CMD = previous
    }
  })
})
