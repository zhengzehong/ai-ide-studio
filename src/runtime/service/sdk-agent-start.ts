import type { RuntimeStateSnapshot } from '../../ports/runtime-port.js'
import type { ResourceGovernor } from '../resources/resource-governor.js'
import { createAcpRuntimeClient } from './acp-runtime-client.js'
import type { StartManagedAcpAgentInput } from './managed-acp-agent.js'
import type {
  SdkAgentRuntime,
  SdkRuntimeHostOptions,
  SdkSessionRuntime,
} from './sdk-runtime-types.js'

export async function createSdkAgentRuntime(input: {
  snapshot: RuntimeStateSnapshot
  fingerprint: string
  resources: ResourceGovernor
  sessions: Map<string, SdkSessionRuntime>
  options: SdkRuntimeHostOptions
  startAgent: (input: StartManagedAcpAgentInput) => Promise<{
    process: SdkAgentRuntime['process']
    connection: SdkAgentRuntime['connection']
    agentCapabilities?: SdkAgentRuntime['agentCapabilities']
  }>
  acceptTurnUpdate: (sessionId: string, streamGeneration: string) => boolean
}): Promise<SdkAgentRuntime> {
  const { snapshot } = input
  const router = createAcpRuntimeClient({
    agentId: snapshot.agent.id,
    resources: input.resources,
    publishUpdate: (update) => input.options.publishUpdate(snapshot.agent.id, update),
    updateCapabilities: (sessionId, update) => {
      const session = input.sessions.get(sessionId)
      if (session) session.capabilities = update(session.capabilities)
    },
    publishCapabilities: (sessionId, capabilities) => input.options.publishCapabilities?.(sessionId, capabilities),
    acceptTurnUpdate: input.acceptTurnUpdate,
  })
  const command = snapshot.runtime.command
  if (!command) {
    router.close()
    throw new Error(`Runtime command is missing for ${snapshot.agent.runtime}`)
  }
  const managed = await input.startAgent({
    agentId: snapshot.agent.id,
    runtime: snapshot.agent.runtime,
    command,
    env: snapshot.runtime.env,
    gatewayAuth: snapshot.runtime.gatewayAuth,
    router,
  })
  let rejectExit: ((error: Error) => void) | undefined
  const exitPromise = new Promise<never>((_resolve, reject) => { rejectExit = reject })
  void exitPromise.catch(() => undefined)
  return {
    fingerprint: input.fingerprint,
    process: managed.process,
    connection: managed.connection,
    router,
    agentCapabilities: managed.agentCapabilities,
    exitPromise,
    rejectExit: rejectExit!,
    stopping: false,
    lastUsedAt: Date.now(),
  }
}
