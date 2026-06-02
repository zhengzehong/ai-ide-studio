import { describe, expect, test } from 'vitest'
import { selectChatAgent } from '../../ui/src/pages/workspace/helpers.ts'
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
