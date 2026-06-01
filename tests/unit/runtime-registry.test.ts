import { describe, expect, test } from 'vitest'
import { buildRuntimeEnv, getRuntimeCommand, selectSystemCodexPath } from '../../src/acp/runtime-registry.js'

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

  test('prefers system codex command for codex-acp app server', () => {
    const systemCodex = process.platform === 'win32' ? 'C:\\Tools\\codex.cmd' : '/usr/local/bin/codex'
    const env = buildRuntimeEnv('codex', {}, () => [systemCodex])
    expect(env.CODEX_PATH).toBe(systemCodex)
  })

  test('keeps explicit CODEX_PATH override', () => {
    const env = buildRuntimeEnv('codex', { CODEX_PATH: 'custom-codex' }, () => ['C:\\Tools\\codex.cmd'])
    expect(env.CODEX_PATH).toBe('custom-codex')
  })

  test('uses Codex config model_provider for codex-acp resume compatibility', () => {
    const env = buildRuntimeEnv(
      'codex',
      {},
      () => [],
      () => 'model_provider = "club"\nmodel = "gpt-5.5"\n',
    )
    expect(env.MODEL_PROVIDER).toBe('club')
  })

  test('keeps explicit MODEL_PROVIDER override', () => {
    const env = buildRuntimeEnv(
      'codex',
      { MODEL_PROVIDER: 'openai' },
      () => [],
      () => 'model_provider = "club"\n',
    )
    expect(env.MODEL_PROVIDER).toBe('openai')
  })

  test('does not set Codex model provider for non-codex runtimes', () => {
    const env = buildRuntimeEnv(
      'claude',
      {},
      () => ['C:\\Tools\\codex.cmd'],
      () => 'model_provider = "club"\n',
    )
    expect(env.MODEL_PROVIDER).toBeUndefined()
    expect(env.CODEX_PATH).toBeUndefined()
  })

  test('selects cmd wrapper before exe on Windows and skips project bin', () => {
    const selected = selectSystemCodexPath(
      ['D:\\repo\\node_modules\\.bin\\codex.cmd', 'D:\\softs\\codex\\codex.exe', 'C:\\nvm4w\\nodejs\\codex.cmd'],
      'win32',
    )
    expect(selected).toBe('C:\\nvm4w\\nodejs\\codex.cmd')
  })
})
