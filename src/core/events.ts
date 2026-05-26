import mitt from 'mitt'
import type { AgentStatus, SessionUpdateData, TaskStatus, TurnUsageData, SessionCapabilities } from '../types/ws-protocol.js'

export type AppEvents = {
  'session:update': { sessionId: string; agentId: string; data: SessionUpdateData }
  'session:done': { sessionId: string; agentId: string; messageId: string; turnUsage?: TurnUsageData }
  'session:capabilities': { sessionId: string; capabilities: SessionCapabilities }
  'agent:status': { agentId: string; status: AgentStatus }
  'task:update': { taskId: string; data: Record<string, unknown> }
  'task:created': { taskId: string; title: string; assignAgentId?: string }
  'rule:update': { ruleId: string; data: Record<string, unknown> }
}

export const events = mitt<AppEvents>()
