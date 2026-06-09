import { events } from '../core/events.js'
import { createChildLogger } from '../core/logger.js'
import { sessionStore, type SessionRuntimePreferences } from '../store/sessions.js'
import type { ConfigOptionInfo, SessionCapabilities } from '../types/ws-protocol.js'
import { mapConfigOptions, mergeCapabilitiesFromConfig } from './capabilities.js'
import type { AgentConnection } from './host-types.js'

const log = createChildLogger('acp-session-prefs')

const DEFAULT_MODE_BY_RUNTIME: Record<string, string> = {
  codex: 'agent-full-access',
  claude: 'bypassPermissions',
}

export async function applySessionRuntimePreferences(
  conn: AgentConnection,
  ourSessionId: string,
): Promise<void> {
  const acpSessionId = conn.acpSessions.get(ourSessionId)
  if (!acpSessionId) return

  const caps = conn.sessionCapabilities.get(ourSessionId) || {}
  const prefs = sessionStore.getRuntimePreferences(ourSessionId)

  await applyModelPreference(conn, ourSessionId, acpSessionId, caps, prefs)
  await applyModePreference(conn, ourSessionId, acpSessionId, caps, prefs)
  await applyConfigPreferences(conn, ourSessionId, acpSessionId, caps, prefs)
}

async function applyModelPreference(
  conn: AgentConnection,
  ourSessionId: string,
  acpSessionId: string,
  caps: SessionCapabilities,
  prefs: SessionRuntimePreferences,
): Promise<void> {
  const modelId = prefs.modelId
  if (!modelId || modelId === caps.currentModelId) return
  if (!caps.models?.some((model) => model.modelId === modelId)) {
    log.warn({ agentId: conn.agentId, ourSessionId, modelId }, 'saved session model is unavailable')
    return
  }

  try {
    await setSessionModel(conn, acpSessionId, modelId)
    const nextCaps = conn.sessionCapabilities.get(ourSessionId) || caps
    nextCaps.currentModelId = modelId
    conn.sessionCapabilities.set(ourSessionId, nextCaps)
  } catch (err) {
    log.warn({ err, agentId: conn.agentId, ourSessionId, modelId }, 'failed to restore session model')
  }
}

async function setSessionModel(conn: AgentConnection, acpSessionId: string, modelId: string): Promise<void> {
  try {
    await conn.connection.unstable_setSessionModel({ sessionId: acpSessionId, modelId })
  } catch (err) {
    try {
      await conn.connection.setSessionConfigOption({
        sessionId: acpSessionId,
        configId: 'model',
        value: modelId,
      })
    } catch (err2) {
      throw new Error(`restore model failed: ${(err as Error).message}, ${(err2 as Error).message}`, { cause: err2 })
    }
  }
}

async function applyModePreference(
  conn: AgentConnection,
  ourSessionId: string,
  acpSessionId: string,
  caps: SessionCapabilities,
  prefs: SessionRuntimePreferences,
): Promise<void> {
  const modeId = prefs.modeId ?? DEFAULT_MODE_BY_RUNTIME[conn.runtime]
  if (!modeId || modeId === caps.currentModeId) return
  if (!caps.modes?.some((mode) => mode.modeId === modeId)) {
    log.warn({ agentId: conn.agentId, ourSessionId, modeId, runtime: conn.runtime }, 'desired session mode is unavailable')
    return
  }

  try {
    await conn.connection.setSessionMode({ sessionId: acpSessionId, modeId })
    const nextCaps = conn.sessionCapabilities.get(ourSessionId) || caps
    nextCaps.currentModeId = modeId
    conn.sessionCapabilities.set(ourSessionId, nextCaps)
  } catch (err) {
    log.warn({ err, agentId: conn.agentId, ourSessionId, modeId }, 'failed to restore session mode')
  }
}

async function applyConfigPreferences(
  conn: AgentConnection,
  ourSessionId: string,
  acpSessionId: string,
  caps: SessionCapabilities,
  prefs: SessionRuntimePreferences,
): Promise<void> {
  const config = prefs.config
  if (!config) return

  for (const [configId, value] of Object.entries(config)) {
    const option = caps.configOptions?.find((item) => item.id === configId)
    if (!option || !isConfigValueAvailable(option, value) || option.currentValue === value) continue
    try {
      const result =
        typeof value === 'boolean'
          ? await conn.connection.setSessionConfigOption({ sessionId: acpSessionId, configId, type: 'boolean', value })
          : await conn.connection.setSessionConfigOption({ sessionId: acpSessionId, configId, value })
      if (result.configOptions?.length) {
        const nextCaps = mergeCapabilitiesFromConfig(
          conn.sessionCapabilities.get(ourSessionId) || caps,
          mapConfigOptions(result.configOptions),
        )
        conn.sessionCapabilities.set(ourSessionId, nextCaps)
      } else {
        updateLocalConfigValue(conn.sessionCapabilities.get(ourSessionId) || caps, configId, value)
      }
    } catch (err) {
      log.warn({ err, agentId: conn.agentId, ourSessionId, configId }, 'failed to restore session config option')
    }
  }
}

function isConfigValueAvailable(option: ConfigOptionInfo, value: string | boolean): boolean {
  if (typeof value === 'boolean') return option.type === 'boolean'
  if (!option.options || option.options.length === 0) return true
  return option.options.some((item) => item.value === value)
}

function updateLocalConfigValue(caps: SessionCapabilities, configId: string, value: string | boolean): void {
  const option = caps.configOptions?.find((item) => item.id === configId)
  if (option) option.currentValue = value
}

export function emitRuntimePreferencesApplied(conn: AgentConnection, ourSessionId: string): void {
  const caps = conn.sessionCapabilities.get(ourSessionId)
  if (!caps) return
  events.emit('session:capabilities', { sessionId: ourSessionId, capabilities: caps })
}
