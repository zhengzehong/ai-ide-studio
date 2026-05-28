import * as acp from '@agentclientprotocol/sdk'
import { events } from '../core/events.js'
import type { SessionCapabilities } from '../types/ws-protocol.js'
import { resolveToolsAsMcpServers } from '../tools/resolver.js'
import { mapConfigOptions, mergeCapabilitiesFromConfig } from './capabilities.js'
import type { AcpSessionContext, AgentConnection, InitialSessionState } from './host-types.js'

export function updateInitialCapabilities(conn: AgentConnection, ourSessionId: string, result: InitialSessionState): SessionCapabilities {
  let caps: SessionCapabilities = conn.sessionCapabilities.get(ourSessionId) || {}

  if (result.models) {
    caps = {
      ...caps,
      models: result.models.availableModels.map(m => ({
        modelId: m.modelId,
        name: m.name,
        description: m.description ?? undefined,
      })),
      currentModelId: result.models.currentModelId,
    }
  }

  if (conn.agentCapabilities?.promptCapabilities) {
    caps = {
      ...caps,
      supportsImages: conn.agentCapabilities.promptCapabilities.image ?? false,
      supportsAudio: conn.agentCapabilities.promptCapabilities.audio ?? false,
    }
  }

  if (result.modes) {
    caps = {
      ...caps,
      modes: result.modes.availableModes.map(m => ({ modeId: m.id, name: m.name, description: m.description ?? undefined })),
      currentModeId: result.modes.currentModeId,
    }
  }

  if (result.configOptions) {
    caps = mergeCapabilitiesFromConfig(caps, mapConfigOptions(result.configOptions))
  }

  conn.sessionCapabilities.set(ourSessionId, caps)
  events.emit('session:capabilities', { sessionId: ourSessionId, capabilities: caps })
  return caps
}

export function resolveMcpServersForAcp(conn: AgentConnection, ourSessionId: string, context: AcpSessionContext): acp.McpServer[] {
  return resolveToolsAsMcpServers({
    agentId: conn.agentId,
    projectId: context.projectId,
    sessionId: ourSessionId,
    preferHttp: conn.agentCapabilities?.mcpCapabilities?.http === true,
    baseUrl: process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? '18800'}`,
  })
}
