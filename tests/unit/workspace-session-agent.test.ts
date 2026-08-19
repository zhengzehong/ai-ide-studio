import { describe, expect, test } from 'vitest'
import {
  chatContentKey,
  canRestoreProjectSession,
  selectChatAgent,
  shouldClearProjectLastSessionForMissingCurrent,
} from '../../ui/src/pages/workspace/helpers.ts'
import type { AgentData } from '../../ui/src/stores/agent.store.ts'
import type { SessionData } from '../../ui/src/stores/session.store.ts'

function agent(id: string, name: string): AgentData {
  return {
    id,
    name,
    type: 'dev',
    runtime: 'codex',
    status: 'running',
    permission_level: 1,
    config_json: null,
    created_at: '2026-01-01T00:00:00.000Z',
    project_id: 'proj-1',
  }
}

function session(id: string, agentId: string): SessionData {
  return {
    id,
    agent_id: agentId,
    task_id: null,
    acp_session_id: null,
    status: 'active',
    stage: '',
    started_at: '2026-01-01T00:00:00.000Z',
    closed_at: null,
    project_id: 'proj-1',
  }
}

describe('selectChatAgent', () => {
  test('uses current session agent instead of stale selected agent', () => {
    const codeEngineer = agent('agent-dev', '代码工程师')
    const reviewer = agent('agent-reviewer', '代码审查员')

    const selected = selectChatAgent({
      agents: [codeEngineer, reviewer],
      sessions: [session('sess-reviewer', 'agent-reviewer')],
      currentSessionId: 'sess-reviewer',
      selectedAgentId: 'agent-dev',
    })

    expect(selected?.id).toBe('agent-reviewer')
  })

  test('falls back to selected agent when no current session is selected', () => {
    const codeEngineer = agent('agent-dev', '代码工程师')
    const reviewer = agent('agent-reviewer', '代码审查员')

    const selected = selectChatAgent({
      agents: [codeEngineer, reviewer],
      sessions: [],
      currentSessionId: null,
      selectedAgentId: 'agent-dev',
    })

    expect(selected?.id).toBe('agent-dev')
  })
})

describe('chatContentKey', () => {
  test('uses a stable session-scoped key for the chat message subtree', () => {
    expect(chatContentKey('sess-reviewer')).toBe('chat-content:sess-reviewer')
  })

  test('uses a no-session key before selecting a session', () => {
    expect(chatContentKey(null)).toBe('chat-content:none')
  })
})

describe('project session recovery', () => {
  test('preserves the target project selection while clearing another project current session', () => {
    expect(shouldClearProjectLastSessionForMissingCurrent('session-c', 'session-a')).toBe(false)
  })

  test('clears the target project selection when its remembered session is missing', () => {
    expect(shouldClearProjectLastSessionForMissingCurrent('session-a', 'session-a')).toBe(true)
  })

  test('does not restore a session whose Agent is hidden', () => {
    const hiddenAgent = { ...agent('agent-dev', '代码工程师'), hidden_at: '2026-08-19T12:18:52.680Z' }
    expect(canRestoreProjectSession(session('sess-hidden', hiddenAgent.id), hiddenAgent)).toBe(false)
  })

  test('restores a visible, retained session', () => {
    expect(canRestoreProjectSession(session('sess-visible', 'agent-dev'), agent('agent-dev', '代码工程师'))).toBe(true)
  })
})
