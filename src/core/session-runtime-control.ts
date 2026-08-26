import { globalAssistantStore } from '../store/global-assistant.js'
import { projectStore } from '../store/projects.js'
import { sessionStore } from '../store/sessions.js'
import type { ConfigOptionInfo, SessionCapabilities } from '../types/ws-protocol.js'
import { buildRuntimeStateSnapshot } from '../runtime/api/runtime-snapshot.js'
import { getRuntimePort } from '../runtime/runtime-port-provider.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('session-runtime-control')

export type SessionRuntimeConfigValue = string | boolean

export interface SessionRuntimeConfiguration {
  modelId?: string
  modeId?: string
  config?: Record<string, SessionRuntimeConfigValue>
}

export interface SessionRuntimeCapabilitiesResult extends SessionCapabilities {
  sessionId: string
  agentId: string
  runtimeReady: true
}

export interface SessionRuntimeConfigurationResult {
  sessionId: string
  requested: SessionRuntimeConfiguration
  applied: {
    modelId: string | null
    modeId: string | null
    config: Record<string, SessionRuntimeConfigValue>
  }
  capabilities: SessionCapabilities
}

export async function getSessionRuntimeCapabilities(
  sessionId: string,
  options: { emitLifecycle?: boolean } = {},
): Promise<SessionRuntimeCapabilitiesResult> {
  const { agentId } = await ensureSessionRuntime(sessionId, options.emitLifecycle !== false)
  const capabilities = await requireCapabilities(agentId, sessionId)
  return { ...capabilities, sessionId, agentId, runtimeReady: true }
}

export async function configureSessionRuntime(
  sessionId: string,
  requested: SessionRuntimeConfiguration,
): Promise<SessionRuntimeConfigurationResult> {
  if (!requested.modelId && !requested.modeId && Object.keys(requested.config ?? {}).length === 0) {
    throw new Error('至少需要提供 modelId、modeId 或 config')
  }

  const initial = await getSessionRuntimeCapabilities(sessionId, { emitLifecycle: false })
  validateConfiguration(initial, requested)
  const port = getRuntimePort()
  let capabilities: SessionCapabilities = initial

  if (requested.modelId) {
    await port.setModel(initial.agentId, sessionId, requested.modelId)
    capabilities = await requireCapabilities(initial.agentId, sessionId)
    if (capabilities.currentModelId !== requested.modelId) {
      throw new Error(`模型配置未生效: requested=${requested.modelId}, applied=${capabilities.currentModelId ?? 'none'}`)
    }
    sessionStore.updateRuntimePreferences(sessionId, { modelId: requested.modelId })
  }

  if (requested.modeId) {
    await port.setMode(initial.agentId, sessionId, requested.modeId)
    capabilities = await requireCapabilities(initial.agentId, sessionId)
    if (capabilities.currentModeId !== requested.modeId) {
      throw new Error(`模式配置未生效: requested=${requested.modeId}, applied=${capabilities.currentModeId ?? 'none'}`)
    }
    sessionStore.updateRuntimePreferences(sessionId, { modeId: requested.modeId })
  }

  for (const [configId, value] of Object.entries(requested.config ?? {})) {
    await port.setConfig(initial.agentId, sessionId, configId, value)
    capabilities = await requireCapabilities(initial.agentId, sessionId)
    const appliedValue = capabilities.configOptions?.find((option) => option.id === configId)?.currentValue
    if (appliedValue !== value) {
      throw new Error(`配置未生效: ${configId}, requested=${String(value)}, applied=${String(appliedValue)}`)
    }
    sessionStore.updateRuntimePreferences(sessionId, { config: { [configId]: value } })
  }

  const appliedConfig = requestedConfigValues(capabilities.configOptions, requested.config)
  log.info(
    {
      sessionId,
      agentId: initial.agentId,
      requestedModelId: requested.modelId,
      appliedModelId: capabilities.currentModelId,
      requestedModeId: requested.modeId,
      appliedModeId: capabilities.currentModeId,
      configIds: Object.keys(requested.config ?? {}),
    },
    'Session Runtime configuration applied',
  )
  return {
    sessionId,
    requested: cloneConfiguration(requested),
    applied: {
      modelId: capabilities.currentModelId ?? null,
      modeId: capabilities.currentModeId ?? null,
      config: appliedConfig,
    },
    capabilities,
  }
}

export async function ensureSessionRuntime(
  sessionId: string,
  emitLifecycle = true,
): Promise<{ agentId: string; acpSessionId: string }> {
  const session = sessionStore.get(sessionId)
  if (!session) throw new Error('会话不存在')
  const context = resolveRuntimeContext(sessionId, session.project_id)
  const snapshot = buildRuntimeStateSnapshot({ sessionId, projectId: context.projectId, cwd: context.cwd })
  const acpSessionId = await getRuntimePort().ensureSession(snapshot, { emitLifecycle })
  if (session.acp_session_id && session.acp_session_id !== acpSessionId) {
    sessionStore.clearAcpSessionId(sessionId)
    log.warn(
      { sessionId, agentId: session.agent_id, staleAcpSessionId: session.acp_session_id, replacementAcpSessionId: acpSessionId },
      'Cleared stale ACP Session mapping after provisional Runtime recovery',
    )
  }
  return { agentId: session.agent_id, acpSessionId }
}

function resolveRuntimeContext(
  sessionId: string,
  projectId: string | null,
): { projectId?: string; cwd?: string } {
  const globalWorkspaceDir = globalAssistantStore.workspaceForSession(sessionId)
  if (globalWorkspaceDir) return { projectId: projectId ?? undefined, cwd: globalWorkspaceDir }
  const project = projectId ? projectStore.get(projectId) : undefined
  return { projectId: projectId ?? undefined, cwd: project?.work_dir }
}

async function requireCapabilities(agentId: string, sessionId: string): Promise<SessionCapabilities> {
  const capabilities = await getRuntimePort().getSessionCapabilities(agentId, sessionId)
  if (!capabilities) throw new Error('Runtime 未返回 Session capabilities')
  return capabilities
}

function validateConfiguration(capabilities: SessionCapabilities, requested: SessionRuntimeConfiguration): void {
  if (requested.modelId && !capabilities.models?.some((model) => model.modelId === requested.modelId)) {
    throw new Error(`模型不可用: ${requested.modelId}`)
  }
  if (requested.modeId && !capabilities.modes?.some((mode) => mode.modeId === requested.modeId)) {
    throw new Error(`模式不可用: ${requested.modeId}`)
  }
  for (const [configId, value] of Object.entries(requested.config ?? {})) {
    const option = capabilities.configOptions?.find((item) => item.id === configId)
    if (!option) throw new Error(`Session 配置项不可用: ${configId}`)
    validateConfigValue(option, value)
  }
}

function validateConfigValue(option: ConfigOptionInfo, value: SessionRuntimeConfigValue): void {
  if (option.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`Session 配置项 ${option.id} 必须是 boolean`)
    return
  }
  if (typeof value !== 'string') throw new Error(`Session 配置项 ${option.id} 必须是 string`)
  if (option.options && !option.options.some((item) => item.value === value)) {
    throw new Error(`Session 配置值不可用: ${option.id}=${value}`)
  }
}

function requestedConfigValues(
  options: ConfigOptionInfo[] | undefined,
  requested: Record<string, SessionRuntimeConfigValue> | undefined,
): Record<string, SessionRuntimeConfigValue> {
  const result: Record<string, SessionRuntimeConfigValue> = {}
  for (const configId of Object.keys(requested ?? {})) {
    const value = options?.find((option) => option.id === configId)?.currentValue
    if (typeof value === 'string' || typeof value === 'boolean') result[configId] = value
  }
  return result
}

function cloneConfiguration(input: SessionRuntimeConfiguration): SessionRuntimeConfiguration {
  return {
    ...(input.modelId ? { modelId: input.modelId } : {}),
    ...(input.modeId ? { modeId: input.modeId } : {}),
    ...(input.config ? { config: { ...input.config } } : {}),
  }
}
