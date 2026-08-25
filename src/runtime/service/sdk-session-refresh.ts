import { modelProfileChanged } from '../../acp/runtime-model-preference.js'
import type { RuntimeStateSnapshot } from '../../ports/runtime-port.js'
import { createChildLogger } from '../../shared/logger.js'
import { touchSdkSession } from './sdk-runtime-state.js'
import type { SdkAgentRuntime, SdkSessionRuntime } from './sdk-runtime-types.js'

const log = createChildLogger('sdk-session-refresh')

interface SessionRefreshState {
  deferredAcpSessionId?: string
  profileChanged: boolean
}

export function inspectSdkSessionRefresh(input: {
  agents: Map<string, SdkAgentRuntime>
  contextFingerprint: string
  existing?: SdkSessionRuntime
  snapshot: RuntimeStateSnapshot
}): SessionRefreshState {
  const { existing, snapshot } = input
  const profileChanged = existing ? modelProfileChanged(
    existing.snapshot.runtime.appliedModelProfile,
    snapshot.runtime.appliedModelProfile,
  ) : false
  const contextChanged = existing?.contextFingerprint !== input.contextFingerprint
  if (!existing?.active || (!contextChanged && !profileChanged)) return { profileChanged }

  touchSdkSession(input.agents, existing)
  log.warn(
    { agentId: snapshot.agent.id, sessionId: snapshot.session.id, contextChanged, profileChanged },
    'deferred Session Runtime refresh until the active turn completes',
  )
  return { deferredAcpSessionId: existing.acpSessionId, profileChanged }
}
