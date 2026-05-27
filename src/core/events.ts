import mittModule from 'mitt'
import type { AgentStatus, SessionDoneData, SessionUpdateData, SessionCapabilities, SessionEventData } from '../types/ws-protocol.js'

export type AppEvents = {
  'session:update': { sessionId: string; agentId: string; data: SessionUpdateData }
  'session:event': { sessionId: string; agentId?: string | null; event: SessionEventData }
  'session:done': SessionDoneData
  'session:capabilities': { sessionId: string; capabilities: SessionCapabilities }
  'agent:status': { agentId: string; status: AgentStatus }
  'task:update': { taskId: string; data: Record<string, unknown> }
  'task:created': { taskId: string; title: string; assignAgentId?: string }
  'rule:update': { ruleId: string; data: Record<string, unknown> }
}

const mitt = mittModule as unknown as typeof import('mitt').default

export const events = mitt<AppEvents>()
