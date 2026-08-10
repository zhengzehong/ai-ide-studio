import type * as acp from '@agentclientprotocol/sdk'
import { mapConfigOptions, mergeCapabilitiesFromConfig } from '../../acp/capabilities.js'
import { configPreferencesWithDefaults } from '../../acp/runtime-config-defaults.js'
import { resolveDesiredRuntimeMode } from '../../acp/runtime-mode-preference.js'
import { resolveRuntimeModelPreference } from '../../acp/runtime-model-preference.js'
import type { RuntimeStateSnapshot } from '../../ports/runtime-port.js'
import { createChildLogger } from '../../shared/logger.js'
import type { SessionCapabilities } from '../../types/ws-protocol.js'

const log = createChildLogger('sdk-session-runtime')

export async function openSdkSession(input: {
  connection: acp.ClientSideConnection
  snapshot: RuntimeStateSnapshot
  agentCapabilities?: acp.AgentCapabilities
  acpSessionIdToResume: string | null
  lifecycle?: (eventType: string, content: string) => void
}): Promise<{ acpSessionId: string; capabilities: SessionCapabilities }> {
  const params = {
    cwd: input.snapshot.session.cwd,
    mcpServers: input.snapshot.mcpServers,
    _meta: input.snapshot.runtime.sessionMeta,
  }
  let acpSessionId: string
  let initial: {
    models?: acp.SessionModelState | null
    modes?: acp.SessionModeState | null
    configOptions?: acp.SessionConfigOption[] | null
  }
  if (input.acpSessionIdToResume && input.agentCapabilities?.sessionCapabilities?.resume) {
    input.lifecycle?.('lifecycle.session_resuming', '正在恢复会话...')
    initial = await input.connection.resumeSession({ sessionId: input.acpSessionIdToResume, ...params })
    acpSessionId = input.acpSessionIdToResume
  } else if (input.acpSessionIdToResume && input.agentCapabilities?.loadSession) {
    input.lifecycle?.('lifecycle.session_resuming', '正在恢复会话...')
    initial = await input.connection.loadSession({ sessionId: input.acpSessionIdToResume, ...params })
    acpSessionId = input.acpSessionIdToResume
  } else {
    input.lifecycle?.('lifecycle.session_creating', '正在连接会话...')
    const created = await input.connection.newSession(params)
    initial = created
    acpSessionId = created.sessionId
  }
  return {
    acpSessionId,
    capabilities: initialCapabilities(initial, input.agentCapabilities),
  }
}

export async function applySdkSessionPreferences(input: {
  snapshot: RuntimeStateSnapshot
  capabilities: SessionCapabilities
  setModel: (modelId: string) => Promise<void>
  setMode: (modeId: string) => Promise<void>
  setConfig: (configId: string, value: string | boolean) => Promise<void>
}): Promise<void> {
  const preferences = input.snapshot.runtimePreferences
  const modelId = resolveRuntimeModelPreference({
    runtime: input.snapshot.agent.runtime,
    profile: input.snapshot.runtime.appliedModelProfile,
    capabilities: input.capabilities,
    sessionModelId: preferences.modelId,
  })
  if (modelId && modelId !== input.capabilities.currentModelId) await input.setModel(modelId)
  const modeId = resolveDesiredRuntimeMode(input.snapshot.agent.runtime, preferences.modeId)
  if (modeId && modeId !== input.capabilities.currentModeId) {
    if (input.capabilities.modes?.some((mode) => mode.modeId === modeId)) {
      try {
        await input.setMode(modeId)
      } catch (err) {
        log.warn(
          { err, agentId: input.snapshot.agent.id, sessionId: input.snapshot.session.id, modeId },
          'failed to restore Runtime session mode',
        )
      }
    } else {
      log.warn(
        {
          agentId: input.snapshot.agent.id,
          sessionId: input.snapshot.session.id,
          runtime: input.snapshot.agent.runtime,
          modeId,
        },
        'desired Runtime session mode is unavailable',
      )
    }
  }
  const profileConfig = input.snapshot.runtime.appliedModelProfile?.effort
    ? { effort: input.snapshot.runtime.appliedModelProfile.effort }
    : undefined
  const desiredConfig = { ...profileConfig, ...preferences.config }
  const config = configPreferencesWithDefaults(
    input.capabilities.configOptions,
    Object.keys(desiredConfig).length > 0 ? desiredConfig : undefined,
  )
  for (const [configId, value] of Object.entries(config ?? {})) {
    const option = input.capabilities.configOptions?.find((item) => item.id === configId)
    if (!option || option.currentValue === value || !isConfigValueAvailable(option, value)) continue
    await input.setConfig(configId, value)
  }
}

function isConfigValueAvailable(
  option: NonNullable<SessionCapabilities['configOptions']>[number],
  value: string | boolean,
): boolean {
  if (typeof value === 'boolean') return option.type === 'boolean'
  return !option.options?.length || option.options.some((item) => item.value === value)
}

export function initialCapabilities(
  initial: {
    models?: acp.SessionModelState | null
    modes?: acp.SessionModeState | null
    configOptions?: acp.SessionConfigOption[] | null
  },
  agentCapabilities?: acp.AgentCapabilities,
): SessionCapabilities {
  const capabilities: SessionCapabilities = {
    models: initial.models?.availableModels.map((model) => ({
      modelId: model.modelId,
      name: model.name,
      description: model.description ?? undefined,
    })),
    currentModelId: initial.models?.currentModelId,
    modes: initial.modes?.availableModes.map((mode) => ({
      modeId: mode.id,
      name: mode.name,
      description: mode.description ?? undefined,
    })),
    currentModeId: initial.modes?.currentModeId,
    supportsImages: agentCapabilities?.promptCapabilities?.image ?? false,
    supportsAudio: agentCapabilities?.promptCapabilities?.audio ?? false,
  }
  return initial.configOptions
    ? mergeCapabilitiesFromConfig(capabilities, mapConfigOptions(initial.configOptions))
    : capabilities
}
