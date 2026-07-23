import type { RuntimeStateSnapshot } from '../../ports/runtime-port.js'
import type { RuntimeCoalescibleUpdate } from '../streams/runtime-update-coalescer.js'
import type { SdkAgentRuntime, SdkRuntimeHostOptions, SdkSessionRuntime } from './sdk-runtime-types.js'

export function requireSdkAgent(agents: Map<string, SdkAgentRuntime>, agentId: string): SdkAgentRuntime {
  const agent = agents.get(agentId)
  if (!agent) throw new Error(`Runtime Agent not found: ${agentId}`)
  return agent
}

export function requireSdkSession(
  sessions: Map<string, SdkSessionRuntime>,
  sessionId: string,
  agentId: string,
): SdkSessionRuntime {
  const session = sessions.get(sessionId)
  if (!session) throw new Error(`Runtime Session not found: ${sessionId}`)
  if (session.snapshot.agent.id !== agentId) throw new Error(`Runtime Session Agent mismatch: ${sessionId}`)
  return session
}

export function touchSdkSession(agents: Map<string, SdkAgentRuntime>, session: SdkSessionRuntime): void {
  const now = Date.now()
  session.lastUsedAt = now
  const agent = agents.get(session.snapshot.agent.id)
  if (agent) agent.lastUsedAt = now
}

export function updateSdkSessionConfigPreference(
  session: SdkSessionRuntime,
  configId: string,
  value: string | boolean,
): void {
  session.snapshot.runtimePreferences.config = { ...session.snapshot.runtimePreferences.config, [configId]: value }
}

export function publishSdkLifecycle(
  publishUpdate: SdkRuntimeHostOptions['publishUpdate'],
  snapshot: RuntimeStateSnapshot,
  eventType: string,
  content: string,
): void {
  const messageId = `lifecycle-${snapshot.session.id}-${Date.now()}`
  const update: RuntimeCoalescibleUpdate = {
    kind: 'session-update',
    sessionId: snapshot.session.id,
    messageId,
    data: { messageId, role: 'system', eventType, content },
  }
  publishUpdate(snapshot.agent.id, update)
}
