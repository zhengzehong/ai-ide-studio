import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import * as acp from '@agentclientprotocol/sdk'
import { mapAvailableCommands, mapConfigOptions, mergeCapabilitiesFromConfig } from '../../acp/capabilities.js'
import { contentBlockToText, mapToolCallContent, mapToolCallUpdate, toolCallTitle } from '../../acp/update-mapper.js'
import { createChildLogger } from '../../shared/logger.js'
import type {
  ElicitationRequestData,
  PermissionRequestData,
  SessionCapabilities,
  SessionInfoData,
  SessionUpdateData,
  ToolCallData,
} from '../../types/ws-protocol.js'
import { ResourceGovernor } from '../resources/resource-governor.js'
import type { RuntimeCoalescibleUpdate } from '../streams/runtime-update-coalescer.js'
import { RuntimeTerminalManager } from './runtime-terminal-manager.js'
import {
  resolveAllInteractions,
  resolveMatchingInteractions,
  takeInteraction,
  waitForInteraction,
  type PendingInteraction,
} from './runtime-interaction-state.js'

interface BoundSession {
  ourSessionId: string
  autoApprovedToolNames: Set<string>
  permissionMode?: string
  messageId?: string
  turnId?: string
  streamGeneration?: string
}

const FULL_ACCESS_PERMISSION_MODES = new Set(['bypassPermissions', 'agent-full-access'])
const log = createChildLogger('acp-runtime-client')

export interface AcpRuntimeClientOptions {
  agentId: string
  publishUpdate: (update: RuntimeCoalescibleUpdate) => void
  updateCapabilities: (sessionId: string, update: (current: SessionCapabilities) => SessionCapabilities) => void
  publishCapabilities?: (sessionId: string, capabilities: SessionCapabilities) => void
  acceptTurnUpdate?: (sessionId: string, streamGeneration: string) => boolean
  resources?: ResourceGovernor
}

export interface AcpRuntimeClientRouter {
  client: acp.Client
  bindSession(sessionId: string, acpSessionId: string, autoApprovedToolNames: string[], permissionMode?: string): void
  unbindSession(sessionId: string): void
  setPermissionMode(sessionId: string, permissionMode?: string): void
  beginTurn(sessionId: string, messageId: string, turnId?: string, streamGeneration?: string): void
  endTurn(sessionId: string, streamGeneration?: string): void
  cancelSession(sessionId: string): void
  hasPendingInteractions(sessionId?: string): boolean
  resolvePermission(sessionId: string, requestId: string, optionId?: string, cancelled?: boolean): boolean
  resolveElicitation(
    sessionId: string,
    requestId: string,
    action: 'accept' | 'decline' | 'cancel',
    content?: Record<string, string | number | boolean | string[]>,
  ): boolean
  close(): void
}

export function createAcpRuntimeClient(options: AcpRuntimeClientOptions): AcpRuntimeClientRouter {
  const ownsResources = !options.resources
  const resources = options.resources ?? new ResourceGovernor()
  const terminals = new RuntimeTerminalManager(resources)
  const byAcpSession = new Map<string, BoundSession>()
  const acpByOurSession = new Map<string, string>()
  const permissions = new Map<string, PendingInteraction<acp.RequestPermissionResponse>>()
  const elicitations = new Map<string, PendingInteraction<acp.CreateElicitationResponse>>()
  let closed = false

  const publish = (bound: BoundSession, data: SessionUpdateData): void => {
    if (bound.streamGeneration
      && options.acceptTurnUpdate
      && !options.acceptTurnUpdate(bound.ourSessionId, bound.streamGeneration)) return
    options.publishUpdate({
      kind: 'session-update',
      sessionId: bound.ourSessionId,
      messageId: data.messageId,
      data,
    })
  }

  const applyCapabilities = (
    sessionId: string,
    update: (current: SessionCapabilities) => SessionCapabilities,
  ): void => {
    let next: SessionCapabilities | undefined
    options.updateCapabilities(sessionId, (current) => {
      next = update(current)
      return next
    })
    if (next) options.publishCapabilities?.(sessionId, next)
  }

  const client: acp.Client = {
    async sessionUpdate(params) {
      const bound = byAcpSession.get(params.sessionId)
      if (!bound) return
      const messageId = bound.messageId ?? `message-${randomUUID().slice(0, 8)}`
      const update = params.update
      switch (update.sessionUpdate) {
        case 'agent_message_chunk':
          if (update.content.type === 'text') publish(bound, { messageId, role: 'agent', contentDelta: update.content.text })
          break
        case 'agent_thought_chunk':
          if (update.content.type === 'text') publish(bound, { messageId, role: 'agent', thinking: update.content.text })
          break
        case 'tool_call':
          publish(bound, { messageId, role: 'agent', toolCall: mapToolCall(update) })
          break
        case 'tool_call_update':
          publish(bound, { messageId, role: 'agent', toolCallUpdate: mapToolCallUpdate(update) })
          break
        case 'usage_update':
          publish(bound, {
            messageId,
            role: 'system',
            usage: {
              contextSize: update.size,
              contextUsed: update.used,
              costAmount: update.cost?.amount,
              costCurrency: update.cost?.currency,
            },
          })
          break
        case 'config_option_update': {
          const configOptions = mapConfigOptions(update.configOptions)
          const mode = configOptions.find((option) => option.category === 'mode' || option.id === 'mode')?.currentValue
          if (typeof mode === 'string') bound.permissionMode = mode
          applyCapabilities(bound.ourSessionId, (current) => mergeCapabilitiesFromConfig(current, configOptions))
          publish(bound, { messageId, role: 'system', configOptions })
          break
        }
        case 'session_info_update': {
          const sessionInfo: SessionInfoData = { title: update.title ?? undefined, updatedAt: update.updatedAt ?? undefined }
          applyCapabilities(bound.ourSessionId, (current) => ({ ...current, sessionInfo }))
          publish(bound, { messageId, role: 'system', sessionInfo })
          break
        }
        case 'plan':
          publish(bound, {
            messageId,
            role: 'system',
            plan: update.entries.map((entry) => ({
              content: entry.content,
              status: entry.status,
              priority: entry.priority,
            })),
          })
          break
        case 'current_mode_update':
          bound.permissionMode = update.currentModeId
          applyCapabilities(bound.ourSessionId, (current) => ({ ...current, currentModeId: update.currentModeId }))
          break
        case 'available_commands_update': {
          const commands = mapAvailableCommands(update.availableCommands)
          applyCapabilities(bound.ourSessionId, (current) => ({ ...current, commands }))
          publish(bound, { messageId, role: 'system', commands })
          break
        }
        case 'user_message_chunk':
          publish(bound, {
            messageId,
            role: 'system',
            content: contentBlockToText(update.content),
            eventType: 'user_message_chunk',
          })
          break
      }
    },

    async requestPermission(params) {
      const bound = byAcpSession.get(params.sessionId)
      if (!bound) return { outcome: { outcome: 'cancelled' } }
      const requestedTool = normalizeToolName(params.toolCall.title ?? '')
      const autoApproved = [...bound.autoApprovedToolNames].some((name) => normalizeToolName(name) === requestedTool)
      const allowOnce = params.options.find((option) => option.kind === 'allow_once')
      const allowAlways = params.options.find((option) => option.kind === 'allow_always')
      const fullAccessAllow = allowOnce ?? allowAlways
      if (fullAccessAllow && bound.permissionMode && FULL_ACCESS_PERMISSION_MODES.has(bound.permissionMode)) {
        log.debug(
          { agentId: options.agentId, sessionId: bound.ourSessionId, permissionMode: bound.permissionMode, toolTitle: params.toolCall.title },
          'auto-approved tool permission in full-access mode',
        )
        return { outcome: { outcome: 'selected', optionId: fullAccessAllow.optionId } }
      }
      const internalToolAllow = allowAlways ?? allowOnce
      if (autoApproved && internalToolAllow)
        return { outcome: { outcome: 'selected', optionId: internalToolAllow.optionId } }

      const requestId = `${params.toolCall.toolCallId || 'permission'}-${Date.now()}`
      const permissionRequest: PermissionRequestData = {
        id: requestId,
        toolCall: mapToolCall(params.toolCall),
        options: params.options.map((option) => ({ optionId: option.optionId, name: option.name, kind: option.kind })),
      }
      const response = waitForInteraction(permissions, interactionKey(bound.ourSessionId, requestId), {
        outcome: { outcome: 'cancelled' },
      }, () => publish(bound, { messageId: requestId, role: 'system', eventType: 'permission.result' }))
      publish(bound, { messageId: requestId, role: 'system', permissionRequest })
      return response
    },

    async unstable_createElicitation(params) {
      const scoped = params as acp.CreateElicitationRequest & { sessionId?: string; elicitationId?: string; url?: string }
      const bound = scoped.sessionId ? byAcpSession.get(scoped.sessionId) : [...byAcpSession.values()].at(-1)
      if (!bound) return { action: 'cancel' }
      const requestId = scoped.elicitationId ?? `elicitation-${Date.now()}`
      const elicitationRequest: ElicitationRequestData = {
        id: requestId,
        message: params.message,
        requestedSchema: params.mode === 'form' ? params.requestedSchema : { url: scoped.url },
      }
      const response = waitForInteraction(
        elicitations,
        interactionKey(bound.ourSessionId, requestId),
        { action: 'cancel' },
        () => publish(bound, { messageId: requestId, role: 'system', eventType: 'elicitation.result' }),
      )
      publish(bound, { messageId: requestId, role: 'system', elicitationRequest })
      return response
    },
    async unstable_completeElicitation() {},
    createTerminal: (params) => terminals.create(params),
    terminalOutput: async (params) => terminals.output(params),
    waitForTerminalExit: (params) => terminals.wait(params),
    killTerminal: async (params) => terminals.kill(params),
    releaseTerminal: async (params) => terminals.release(params),
    async readTextFile(params) {
      const lease = await resources.acquire('disk')
      try {
        let content = await readFile(params.path, 'utf8')
        if (params.line != null) {
          const lines = content.split('\n')
          content = lines.slice(params.line - 1, params.limit == null ? undefined : params.line - 1 + params.limit).join('\n')
        }
        return { content }
      } catch {
        return { content: '' }
      } finally {
        lease.release()
      }
    },
    async writeTextFile(params) {
      const lease = await resources.acquire('disk')
      try {
        await mkdir(dirname(params.path), { recursive: true })
        await writeFile(params.path, params.content, 'utf8')
        return {}
      } finally {
        lease.release()
      }
    },
  }

  return {
    client,
    bindSession(sessionId, acpSessionId, autoApprovedToolNames, permissionMode) {
      const bound: BoundSession = {
        ourSessionId: sessionId,
        autoApprovedToolNames: new Set(autoApprovedToolNames),
        permissionMode,
      }
      byAcpSession.set(acpSessionId, bound)
      acpByOurSession.set(sessionId, acpSessionId)
    },
    unbindSession(sessionId) {
      cancelSessionInteractions(sessionId, permissions, elicitations)
      const acpSessionId = acpByOurSession.get(sessionId)
      if (acpSessionId) byAcpSession.delete(acpSessionId)
      acpByOurSession.delete(sessionId)
    },
    setPermissionMode(sessionId, permissionMode) {
      const acpSessionId = acpByOurSession.get(sessionId)
      const bound = acpSessionId ? byAcpSession.get(acpSessionId) : undefined
      if (bound) bound.permissionMode = permissionMode
    },
    beginTurn(sessionId, messageId, turnId, streamGeneration) {
      const acpSessionId = acpByOurSession.get(sessionId)
      const bound = acpSessionId ? byAcpSession.get(acpSessionId) : undefined
      if (bound) Object.assign(bound, { messageId, turnId, streamGeneration })
    },
    endTurn(sessionId, streamGeneration) {
      const acpSessionId = acpByOurSession.get(sessionId)
      const bound = acpSessionId ? byAcpSession.get(acpSessionId) : undefined
      if (bound && (!streamGeneration || bound.streamGeneration === streamGeneration)) {
        delete bound.messageId
        delete bound.turnId
        delete bound.streamGeneration
      }
    },
    cancelSession(sessionId) {
      cancelSessionInteractions(sessionId, permissions, elicitations)
    },
    hasPendingInteractions(sessionId) {
      if (!sessionId) return permissions.size > 0 || elicitations.size > 0
      const prefix = `${sessionId}:`
      return [...permissions.keys()].some((key) => key.startsWith(prefix))
        || [...elicitations.keys()].some((key) => key.startsWith(prefix))
    },
    resolvePermission(sessionId, requestId, optionId, cancelled) {
      const pending = takeInteraction(permissions, interactionKey(sessionId, requestId))
      if (!pending) return false
      pending.resolve(cancelled || !optionId
        ? { outcome: { outcome: 'cancelled' } }
        : { outcome: { outcome: 'selected', optionId } })
      return true
    },
    resolveElicitation(sessionId, requestId, action, content) {
      const pending = takeInteraction(elicitations, interactionKey(sessionId, requestId))
      if (!pending) return false
      pending.resolve(action === 'accept' ? { action, content: content ?? {} } : { action })
      return true
    },
    close() {
      if (closed) return
      closed = true
      resolveAllInteractions(permissions, { outcome: { outcome: 'cancelled' } })
      resolveAllInteractions(elicitations, { action: 'cancel' })
      terminals.close()
      if (ownsResources) resources.close()
      byAcpSession.clear()
      acpByOurSession.clear()
    },
  }
}

function cancelSessionInteractions(
  sessionId: string,
  permissions: Map<string, PendingInteraction<acp.RequestPermissionResponse>>,
  elicitations: Map<string, PendingInteraction<acp.CreateElicitationResponse>>,
): void {
  const prefix = `${sessionId}:`
  resolveMatchingInteractions(permissions, prefix, { outcome: { outcome: 'cancelled' } })
  resolveMatchingInteractions(elicitations, prefix, { action: 'cancel' })
}

function mapToolCall(update: acp.ToolCall | acp.ToolCallUpdate): ToolCallData {
  return {
    id: update.toolCallId,
    title: toolCallTitle(update),
    kind: update.kind ?? undefined,
    status: update.status ?? undefined,
    locations: update.locations?.map((location) => ({ path: location.path, line: location.line ?? undefined })),
    rawInput: update.rawInput,
    rawOutput: update.rawOutput,
    content: mapToolCallContent(update.content ?? undefined),
  }
}

function normalizeToolName(value: string): string {
  const parts = value.startsWith('mcp__') ? value.split('__').slice(2) : [value]
  return parts.join('.').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function interactionKey(sessionId: string, requestId: string): string {
  return `${sessionId}:${requestId}`
}
