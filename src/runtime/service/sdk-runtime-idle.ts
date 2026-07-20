import type { RuntimeStateSnapshot } from '../../ports/runtime-port.js'
import type { RuntimeSessionActorScheduler } from '../actors/session-actor.js'
import type { RuntimeIdleThresholds } from './runtime-idle-sweep.js'
import type { SdkAgentRuntime, SdkSessionRuntime } from './sdk-runtime-types.js'

export interface SdkRuntimeIdleSweepInput extends RuntimeIdleThresholds {
  now: number
  sessions: Map<string, SdkSessionRuntime>
  agents: Map<string, SdkAgentRuntime>
  actors: RuntimeSessionActorScheduler
  closeSession: (agentId: string, sessionId: string) => Promise<void>
  stopAgent: (agentId: string) => Promise<void>
  onSessionDisconnected: (snapshot: RuntimeStateSnapshot) => void
}

export async function sweepSdkRuntimeIdle(input: SdkRuntimeIdleSweepInput): Promise<void> {
  for (const [sessionId, session] of [...input.sessions]) {
    const agent = input.agents.get(session.snapshot.agent.id)
    if (!agent || session.active || input.actors.pendingCount(sessionId) > 0) continue
    if (agent.router.hasPendingInteractions(sessionId)) continue
    if (input.now - session.lastUsedAt <= input.sessionIdleMs) continue
    const snapshot = session.snapshot
    await input.closeSession(snapshot.agent.id, sessionId)
    input.onSessionDisconnected(snapshot)
  }

  for (const [agentId, agent] of [...input.agents]) {
    const ownsSession = [...input.sessions.values()].some((session) => session.snapshot.agent.id === agentId)
    if (ownsSession || agent.router.hasPendingInteractions()) continue
    if (input.now - agent.lastUsedAt <= input.agentIdleMs) continue
    await input.stopAgent(agentId)
  }
}
