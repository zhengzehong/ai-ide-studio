import type { AgentStatus } from '../types/ws-protocol.js'
import { agentStore } from '../store/agents.js'
import { events } from './events.js'

export function applyRuntimeAgentStatus(input: { agentId: string; status: AgentStatus }): void {
  const agent = agentStore.get(input.agentId)
  if (!agent || agent.status === input.status) return
  agentStore.updateStatus(input.agentId, input.status)
  events.emit('agent:status', input)
}
