import type { RuntimeSessionActorScheduler } from '../actors/session-actor.js'
import { createChildLogger } from '../../shared/logger.js'
import type { SdkAgentRuntime, SdkRuntimeHostOptions, SdkSessionRuntime } from './sdk-runtime-types.js'

const log = createChildLogger('sdk-agent-lifecycle')

interface SdkAgentLifecycleInput {
  agentId: string
  agents: Map<string, SdkAgentRuntime>
  sessions: Map<string, SdkSessionRuntime>
  actors: RuntimeSessionActorScheduler
  options: SdkRuntimeHostOptions
}

export function stopSdkAgentRuntime(input: SdkAgentLifecycleInput): void {
  const agent = input.agents.get(input.agentId)
  if (!agent) return
  agent.stopping = true
  agent.rejectExit(new Error(`Agent runtime stopped: ${input.agentId}`))
  removeAgentSessions(input, agent)
  agent.router.close()
  input.agents.delete(input.agentId)
  if (!agent.process.killed) agent.process.kill()
  input.options.publishAgentStatus?.({ agentId: input.agentId, status: 'standby', captureBindingId: agent.captureBindingId })
}

export function handleSdkAgentExit(
  input: SdkAgentLifecycleInput & { runtime: SdkAgentRuntime; code: number | null; signal: NodeJS.Signals | null },
): void {
  if (input.agents.get(input.agentId) !== input.runtime) return
  input.agents.delete(input.agentId)
  removeAgentSessions(input, input.runtime)
  input.runtime.router.close()
  input.runtime.rejectExit(new Error(
    `Agent runtime exited: ${input.agentId} (code=${input.code ?? 'null'}, signal=${input.signal ?? 'null'})`,
  ))
  input.options.publishAgentStatus?.({ agentId: input.agentId, status: 'standby', captureBindingId: input.runtime.captureBindingId })
  if (!input.runtime.stopping) {
    log.warn({ agentId: input.agentId, code: input.code, signal: input.signal }, 'Agent runtime exited unexpectedly')
  }
}

function removeAgentSessions(input: SdkAgentLifecycleInput, runtime: SdkAgentRuntime): void {
  for (const [sessionId, session] of input.sessions) {
    if (session.snapshot.agent.id !== input.agentId) continue
    runtime.router.cancelSession(sessionId)
    runtime.router.unbindSession(sessionId)
    input.sessions.delete(sessionId)
    if (input.actors.pendingCount(sessionId) === 0) input.actors.resetSession(sessionId)
  }
}
