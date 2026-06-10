import mittModule from 'mitt'
import type {
  AgentStatus,
  SessionActivityData,
  SessionDoneData,
  SessionUpdateData,
  SessionCapabilities,
  SessionEventData,
  TurnProcessItemData,
} from '../types/ws-protocol.js'

export type AppEvents = {
  'session:update': { sessionId: string; agentId: string; data: SessionUpdateData }
  'session:process_item': { sessionId: string; agentId?: string | null; item: TurnProcessItemData }
  'session:event': { sessionId: string; agentId?: string | null; event: SessionEventData }
  'session:manual-prompt-started': { sessionId: string; agentId: string }
  'session:activity': SessionActivityData
  'session:done': SessionDoneData
  'session:capabilities': { sessionId: string; capabilities: SessionCapabilities }
  'session:changed': { sessionId: string; data: Record<string, unknown> }
  'session:copy_failed': { sourceSessionId: string; targetSessionId: string; message: string }
  'agent:status': { agentId: string; status: AgentStatus }
  'task:update': { taskId: string; data: Record<string, unknown> }
  'team:update': { teamId: string; sessionIds: string[]; data: Record<string, unknown> }
  'task:created': { taskId: string; title: string; assignAgentId?: string }
  'rule:update': { ruleId: string; data: Record<string, unknown> }
  'timeline:updated': { sessionId: string }
}

const mitt = mittModule as unknown as typeof import('mitt').default

export const events = mitt<AppEvents>()
