import { randomUUID } from 'crypto'
import * as acp from '@agentclientprotocol/sdk'
import { events } from '../core/events.js'
import { createChildLogger } from '../core/logger.js'
import type { ElicitationRequestData, PermissionRequestData, SessionInfoData, SessionUpdateData, ToolCallData } from '../types/ws-protocol.js'
import { mapAvailableCommands, mapConfigOptions, mergeCapabilitiesFromConfig } from './capabilities.js'
import { resolveAutoPermission } from './auto-permission.js'
import { agentConnections, findLatestOurSessionId, findOurSessionId } from './host-state.js'
import { waitForElicitation, waitForPermission } from './interaction-state.js'
import { createTerminalProcess, killTerminal as killTerminalProcess, releaseTerminal as releaseTerminalProcess, terminalOutput as getTerminalOutput, waitForTerminalExit as getTerminalExit } from './terminal-bridge.js'
import { contentBlockToText, mapToolCallContent, mapToolCallUpdate, toolCallTitle } from './update-mapper.js'

const log = createChildLogger('acp-client')
const turnIdsByAgent = new Map<string, Map<string, string>>()

function turnIdsForAgent(agentId: string): Map<string, string> {
  let turnIds = turnIdsByAgent.get(agentId)
  if (!turnIds) {
    turnIds = new Map()
    turnIdsByAgent.set(agentId, turnIds)
  }
  return turnIds
}

export function startClientTurn(agentId: string, acpSessionId: string): void {
  turnIdsForAgent(agentId).set(acpSessionId, generatedTurnMessageId(acpSessionId))
}

export function endClientTurn(agentId: string, acpSessionId: string): void {
  const turnIds = turnIdsByAgent.get(agentId)
  if (!turnIds) return
  turnIds.delete(acpSessionId)
  if (turnIds.size === 0) turnIdsByAgent.delete(agentId)
}

function generatedTurnMessageId(acpSessionId: string): string {
  return `msg-${acpSessionId.slice(0, 8)}-${Date.now()}-${randomUUID().slice(0, 8)}`
}

export function createClientHandler(agentId: string): acp.Client {
  function turnMessageId(acpSessionId: string, _chunkMsgId?: string | null): string {
    const turnIds = turnIdsForAgent(agentId)
    const existing = turnIds.get(acpSessionId)
    if (existing) return existing
    const newId = generatedTurnMessageId(acpSessionId)
    turnIds.set(acpSessionId, newId)
    return newId
  }

  return {
    async sessionUpdate(params) {
      const acpSessionId = params.sessionId
      const ourSessionId = findOurSessionId(agentId, acpSessionId)
      if (!ourSessionId) return

      const update = params.update
      const updateType = update.sessionUpdate

      switch (updateType) {
        case 'agent_message_chunk': {
          const chunk = update as acp.ContentChunk & { sessionUpdate: string }
          const msgId = turnMessageId(acpSessionId, chunk.messageId)
          const block = chunk.content
          if (block.type === 'text') {
            events.emit('session:update', {
              sessionId: ourSessionId, agentId,
              data: { messageId: msgId, role: 'agent', contentDelta: (block as acp.TextContent).text } satisfies SessionUpdateData,
            })
          }
          break
        }
        case 'agent_thought_chunk': {
          const chunk = update as acp.ContentChunk & { sessionUpdate: string }
          const msgId = turnMessageId(acpSessionId, chunk.messageId)
          const block = chunk.content
          if (block.type === 'text') {
            events.emit('session:update', {
              sessionId: ourSessionId, agentId,
              data: { messageId: msgId, role: 'agent', thinking: (block as acp.TextContent).text } satisfies SessionUpdateData,
            })
          }
          break
        }
        case 'tool_call': {
          const tc = update as acp.ToolCall & { sessionUpdate: string }
          const toolData: ToolCallData = {
            id: tc.toolCallId,
            title: toolCallTitle(tc),
            kind: tc.kind ?? undefined,
            status: tc.status ?? 'in_progress',
            locations: tc.locations?.map(l => ({ path: l.path, line: l.line ?? undefined })),
            rawInput: tc.rawInput,
            rawOutput: tc.rawOutput,
            content: mapToolCallContent(tc.content),
          }
          events.emit('session:update', {
            sessionId: ourSessionId, agentId,
            data: { messageId: turnMessageId(acpSessionId), role: 'agent', toolCall: toolData } satisfies SessionUpdateData,
          })
          break
        }
        case 'tool_call_update': {
          const tcu = update as acp.ToolCallUpdate & { sessionUpdate: string }
          const toolData = mapToolCallUpdate(tcu)
          events.emit('session:update', {
            sessionId: ourSessionId, agentId,
            data: { messageId: turnMessageId(acpSessionId), role: 'agent', toolCallUpdate: toolData } satisfies SessionUpdateData,
          })
          break
        }
        case 'usage_update': {
          const uu = update as acp.UsageUpdate & { sessionUpdate: string }
          events.emit('session:update', {
            sessionId: ourSessionId, agentId,
            data: {
              messageId: turnMessageId(acpSessionId),
              role: 'system',
              usage: {
                contextSize: uu.size,
                contextUsed: uu.used,
                costAmount: uu.cost?.amount,
                costCurrency: uu.cost?.currency,
              },
            } satisfies SessionUpdateData,
          })
          break
        }
        case 'config_option_update': {
          const cou = update as acp.ConfigOptionUpdate & { sessionUpdate: string }
          const configOptions = mapConfigOptions(cou.configOptions)
          const conn = agentConnections.get(agentId)
          if (conn) {
            const caps = mergeCapabilitiesFromConfig(conn.sessionCapabilities.get(ourSessionId) || {}, configOptions)
            conn.sessionCapabilities.set(ourSessionId, caps)
            events.emit('session:capabilities', { sessionId: ourSessionId, capabilities: caps })
          }
          events.emit('session:update', {
            sessionId: ourSessionId, agentId,
            data: { messageId: turnMessageId(acpSessionId), role: 'system', configOptions } satisfies SessionUpdateData,
          })
          break
        }
        case 'session_info_update': {
          const siu = update as acp.SessionInfoUpdate & { sessionUpdate: string }
          const sessionInfo: SessionInfoData = { title: siu.title ?? undefined, updatedAt: siu.updatedAt ?? undefined }
          const conn = agentConnections.get(agentId)
          if (conn) {
            const caps = conn.sessionCapabilities.get(ourSessionId) || {}
            caps.sessionInfo = sessionInfo
            conn.sessionCapabilities.set(ourSessionId, caps)
            events.emit('session:capabilities', { sessionId: ourSessionId, capabilities: caps })
          }
          events.emit('session:update', {
            sessionId: ourSessionId, agentId,
            data: { messageId: turnMessageId(acpSessionId), role: 'system', sessionInfo } satisfies SessionUpdateData,
          })
          break
        }
        case 'plan': {
          const plan = update as acp.Plan & { sessionUpdate: string }
          events.emit('session:update', {
            sessionId: ourSessionId, agentId,
            data: {
              messageId: turnMessageId(acpSessionId),
              role: 'system',
              plan: plan.entries.map(e => ({ content: (e as Record<string, unknown>).content as string, status: (e as Record<string, unknown>).status as string, priority: (e as Record<string, unknown>).priority as string })),
            } satisfies SessionUpdateData,
          })
          break
        }
        case 'current_mode_update': {
          const mu = update as acp.CurrentModeUpdate & { sessionUpdate: string }
          const conn = agentConnections.get(agentId)
          if (conn) {
            const caps = conn.sessionCapabilities.get(ourSessionId) || {}
            caps.currentModeId = mu.currentModeId
            conn.sessionCapabilities.set(ourSessionId, caps)
            events.emit('session:capabilities', { sessionId: ourSessionId, capabilities: caps })
          }
          break
        }
        case 'available_commands_update': {
          const acu = update as acp.AvailableCommandsUpdate & { sessionUpdate: string }
          const commands = mapAvailableCommands(acu.availableCommands)
          const conn = agentConnections.get(agentId)
          if (conn) {
            const caps = conn.sessionCapabilities.get(ourSessionId) || {}
            caps.commands = commands
            conn.sessionCapabilities.set(ourSessionId, caps)
            events.emit('session:capabilities', { sessionId: ourSessionId, capabilities: caps })
          }
          events.emit('session:update', {
            sessionId: ourSessionId, agentId,
            data: { messageId: turnMessageId(acpSessionId), role: 'system', commands } satisfies SessionUpdateData,
          })
          break
        }
        case 'user_message_chunk': {
          const chunk = update as acp.ContentChunk & { sessionUpdate: string }
          events.emit('session:update', {
            sessionId: ourSessionId, agentId,
            data: { messageId: chunk.messageId || turnMessageId(acpSessionId), role: 'system', content: contentBlockToText(chunk.content), eventType: 'user_message_chunk' } satisfies SessionUpdateData,
          })
          break
        }
        default:
          log.debug({ agentId, updateType }, '未处理的 sessionUpdate 类型')
          break
      }
    },

    async requestPermission(params) {
      const ourSessionId = findOurSessionId(agentId, params.sessionId)
      if (!ourSessionId) return { outcome: { outcome: 'cancelled' } }

      const autoPermission = resolveAutoPermission({
        agentId,
        ourSessionId,
        toolCall: params.toolCall,
        options: params.options,
      })
      if (autoPermission) {
        log.info(
          { agentId, sessionId: ourSessionId, toolTitle: params.toolCall.title },
          'auto-approved internal Team tool permission',
        )
        return autoPermission
      }

      const requestId = `${params.toolCall.toolCallId || 'permission'}-${Date.now()}`
      const permissionRequest: PermissionRequestData = {
        id: requestId,
        toolCall: mapToolCallUpdate(params.toolCall),
        options: params.options.map(o => ({ optionId: o.optionId, name: o.name, kind: o.kind })),
      }

      events.emit('session:update', {
        sessionId: ourSessionId,
        agentId,
        data: { messageId: requestId, role: 'system', permissionRequest } satisfies SessionUpdateData,
      })

      return waitForPermission(agentId, ourSessionId, requestId)
    },

    async createTerminal(params) {
      const ourSessionId = findOurSessionId(agentId, params.sessionId)
      const terminalId = `term-${randomUUID().slice(0, 8)}`
      return createTerminalProcess(terminalId, params, ourSessionId)
    },

    async terminalOutput(params) {
      return getTerminalOutput(params)
    },

    async waitForTerminalExit(params) {
      return await getTerminalExit(params)
    },

    async killTerminal(params) {
      return killTerminalProcess(params)
    },

    async releaseTerminal(params) {
      return releaseTerminalProcess(params)
    },

    async unstable_createElicitation(params) {
      const scoped = params as acp.CreateElicitationRequest & { sessionId?: string; requestId?: string | number | null; toolCallId?: string | null; elicitationId?: string; url?: string }
      const ourSessionId = scoped.sessionId ? findOurSessionId(agentId, scoped.sessionId) : findLatestOurSessionId(agentId)
      if (!ourSessionId) return { action: 'cancel' }

      const requestId = scoped.elicitationId || (scoped.requestId != null ? String(scoped.requestId) : `elicitation-${Date.now()}`)
      const elicitationRequest: ElicitationRequestData = {
        id: requestId,
        toolCallId: scoped.toolCallId ?? undefined,
        message: params.message,
        requestedSchema: params.mode === 'form' ? params.requestedSchema : { url: scoped.url },
      }

      events.emit('session:update', {
        sessionId: ourSessionId,
        agentId,
        data: { messageId: requestId, role: 'system', elicitationRequest } satisfies SessionUpdateData,
      })

      return waitForElicitation(agentId, ourSessionId, requestId)
    },

    async unstable_completeElicitation() {
      return
    },

    async readTextFile(params) {
      const { readFileSync } = await import('fs')
      try {
        let content = readFileSync(params.path, 'utf-8')
        if (params.line != null && params.limit != null) {
          const lines = content.split('\n')
          content = lines.slice(params.line - 1, params.line - 1 + params.limit).join('\n')
        } else if (params.line != null) {
          content = content.split('\n').slice(params.line - 1).join('\n')
        }
        return { content }
      } catch {
        return { content: '' }
      }
    },

    async writeTextFile(params) {
      const { writeFileSync, mkdirSync } = await import('fs')
      const { dirname } = await import('path')
      try {
        mkdirSync(dirname(params.path), { recursive: true })
        writeFileSync(params.path, params.content, 'utf-8')
      } catch (err) {
        log.error({ err, agentId, path: params.path }, '写文件失败')
      }
      return {}
    },
  }
}
