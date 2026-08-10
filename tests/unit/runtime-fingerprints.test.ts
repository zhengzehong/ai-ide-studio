import { describe, expect, test } from 'vitest'
import {
  runtimeAgentFingerprint,
  runtimeSessionContextFingerprint,
} from '../../src/runtime/service/runtime-fingerprints.js'
import type { RuntimeStateSnapshot } from '../../src/ports/runtime-port.js'

describe('Runtime fingerprints', () => {
  test('tracks runtime credentials and model settings but ignores unrelated environment noise', () => {
    const base = snapshot()
    const unrelated = { ...base, runtime: { ...base.runtime, env: { ...base.runtime.env, TEMP: 'other' } } }
    const changedToken = { ...base, runtime: { ...base.runtime, env: { ...base.runtime.env, ANTHROPIC_API_KEY: 'secret-b' } } }
    const changedContextWindow = {
      ...base,
      runtime: { ...base.runtime, env: { ...base.runtime.env, CLAUDE_CODE_MAX_CONTEXT_TOKENS: '200000' } },
    }

    expect(runtimeAgentFingerprint(unrelated)).toBe(runtimeAgentFingerprint(base))
    expect(runtimeAgentFingerprint(changedToken)).not.toBe(runtimeAgentFingerprint(base))
    expect(runtimeAgentFingerprint(changedContextWindow)).not.toBe(runtimeAgentFingerprint(base))
  })

  test('is stable across object key order and changes with effective Session context', () => {
    const base = snapshot()
    const reordered = {
      ...base,
      runtime: { ...base.runtime, sessionMeta: { nested: { b: 2, a: 1 }, z: true } },
    }
    const originalOrder = {
      ...base,
      runtime: { ...base.runtime, sessionMeta: { z: true, nested: { a: 1, b: 2 } } },
    }
    const changedCwd = { ...base, session: { ...base.session, cwd: `${base.session.cwd}/other` } }
    const changedAutoCompactWindow = {
      ...base,
      runtime: {
        ...base.runtime,
        sessionMeta: { ...base.runtime.sessionMeta, claudeCode: { options: { settings: { autoCompactWindow: 200000 } } } },
      },
    }

    expect(runtimeSessionContextFingerprint(reordered)).toBe(runtimeSessionContextFingerprint(originalOrder))
    expect(runtimeSessionContextFingerprint(changedCwd)).not.toBe(runtimeSessionContextFingerprint(base))
    expect(runtimeSessionContextFingerprint(changedAutoCompactWindow)).not.toBe(runtimeSessionContextFingerprint(base))
  })

  test('tracks a gateway fingerprint without embedding raw credentials', () => {
    const base = snapshot()
    const withGateway = {
      ...base,
      runtime: {
        ...base.runtime,
        gatewayAuth: {
          methodId: 'gateway' as const,
          baseUrl: 'https://gateway.example.com/v1',
          providerName: 'Gateway',
          headers: { Authorization: 'Bearer raw-secret' },
          fingerprint: 'credential-hash-a',
        },
      },
    }
    const changed = {
      ...withGateway,
      runtime: {
        ...withGateway.runtime,
        gatewayAuth: { ...withGateway.runtime.gatewayAuth, fingerprint: 'credential-hash-b' },
      },
    }

    const fingerprint = runtimeAgentFingerprint(withGateway)
    expect(fingerprint).not.toContain('raw-secret')
    expect(fingerprint).not.toBe(runtimeAgentFingerprint(changed))
  })
})

function snapshot(): RuntimeStateSnapshot {
  return {
    agent: { id: 'agent-a', name: 'Agent', type: 'dev', runtime: 'claude', permissionLevel: 3, config: {}, systemPrompt: '', projectId: 'project-a' },
    session: { id: 'session-a', agentId: 'agent-a', taskId: null, projectId: 'project-a', cwd: 'C:/project', title: null, acpSessionId: 'acp-a', isPrimary: false },
    runtime: {
      env: {
        ANTHROPIC_API_KEY: 'secret-a',
        ANTHROPIC_MODEL: 'model-a',
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: '128000',
        TEMP: 'one',
      },
      command: { cmd: 'claude-agent-acp', args: [] },
      sessionMeta: { z: true, nested: { a: 1, b: 2 } },
    },
    runtimePreferences: {},
    mcpServers: [{ name: 'tools', command: 'node', args: ['server.js'], env: [] }],
    autoApprovedToolNames: ['team.mailbox.send'],
  }
}
