import { agentStore, type AgentRow } from '../store/agents.js'
import { sessionStore, type SessionRow } from '../store/sessions.js'
import { createChildLogger } from './logger.js'
import { publishSessionCreated } from './session-change-events.js'

const log = createChildLogger('agent-primary-sessions')

const DEFAULT_AGENTS = [
  { id: 'claude-dev', type: 'dev', name: 'Claude (\u5f00\u53d1)', runtime: 'claude' },
  { id: 'codex-dev', type: 'dev', name: 'Codex (\u5f00\u53d1)', runtime: 'codex' },
  { id: 'mock-dev', type: 'dev', name: 'Mock (\u6d4b\u8bd5)', runtime: 'mock' },
] as const

export interface PrimarySessionReconciliationResult {
  created: SessionRow[]
}

export function seedDefaultAgents(): AgentRow[] {
  const agents = DEFAULT_AGENTS.map((definition) => agentStore.upsert(definition))
  log.info({ count: agents.length }, 'Default Agents initialized')
  return agents
}

export function ensureAgentPrimarySession(agent: AgentRow): { session: SessionRow; created: boolean } {
  const existing = sessionStore.findPrimaryByAgent(agent.id)
  if (existing) return { session: existing, created: false }
  const session = publishSessionCreated(sessionStore.create({
    agentId: agent.id,
    projectId: agent.project_id ?? undefined,
    isPrimary: true,
    title: '\u4e3b\u4f1a\u8bdd',
  }))
  return { session, created: true }
}

export function reconcileAgentPrimarySessions(): PrimarySessionReconciliationResult {
  const agents = agentStore.list()
  const created: SessionRow[] = []
  for (const agent of agents) {
    const result = ensureAgentPrimarySession(agent)
    if (result.created) created.push(result.session)
  }
  log.info({ agentCount: agents.length, createdCount: created.length }, 'Agent primary Sessions reconciled')
  return { created }
}
