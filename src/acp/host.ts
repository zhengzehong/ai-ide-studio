import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { Writable, Readable } from 'stream'
import * as acp from '@agentclientprotocol/sdk'
import { events } from '../core/events.js'
import { agentStore } from '../store/agents.js'
import type { ElicitationRequestData, PermissionRequestData, SessionInfoData, SessionUpdateData, ToolCallData, TurnUsageData, SessionCapabilities, ImageAttachment } from '../types/ws-protocol.js'
import { resolveToolsAsMcpServers } from '../tools/resolver.js'
import { mapAvailableCommands, mapConfigOptions, mergeCapabilitiesFromConfig } from './capabilities.js'
import { contentBlockToText, mapToolCallContent, mapToolCallUpdate, toolCallTitle } from './update-mapper.js'

interface AgentConnection {
  agentId: string
  proc: ChildProcess
  connection: acp.ClientSideConnection
  runtime: string
  acpSessions: Map<string, string>
  sessionCapabilities: Map<string, SessionCapabilities>
  agentCapabilities?: acp.AgentCapabilities
}

interface AcpSessionContext {
  projectId?: string
  cwd?: string
}

const RUNTIME_COMMANDS: Record<string, { cmd: string; args: string[] }> = {
  claude: { cmd: process.platform === 'win32' ? 'npx.cmd' : 'npx', args: ['claude-agent-acp'] },
  codex: { cmd: process.platform === 'win32' ? 'npx.cmd' : 'npx', args: ['codex-acp'] },
}

interface PendingPermission {
  resolve: (value: acp.RequestPermissionResponse) => void
  timeout: ReturnType<typeof setTimeout>
  agentId: string
  requestId: string
}

interface PendingElicitation {
  resolve: (value: acp.CreateElicitationResponse) => void
  timeout: ReturnType<typeof setTimeout>
  agentId: string
  requestId: string
}

interface TerminalProcess {
  sessionId: string
  ourSessionId: string
  proc: ChildProcess
  output: string
  truncated: boolean
  exitCode?: number | null
  signal?: string | null
}

const pendingPermissions = new Map<string, PendingPermission>()
const pendingElicitations = new Map<string, PendingElicitation>()
const terminals = new Map<string, TerminalProcess>()

function requestKey(sessionId: string, requestId: string): string {
  return `${sessionId}:${requestId}`
}

type InitialSessionState = {
  models?: acp.SessionModelState | null
  modes?: acp.SessionModeState | null
  configOptions?: acp.SessionConfigOption[] | null
}

function updateInitialCapabilities(conn: AgentConnection, ourSessionId: string, result: InitialSessionState): SessionCapabilities {
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

function resolveMcpServersForAcp(conn: AgentConnection, ourSessionId: string, context: AcpSessionContext): acp.McpServer[] {
  return resolveToolsAsMcpServers({
    agentId: conn.agentId,
    projectId: context.projectId,
    sessionId: ourSessionId,
    preferHttp: conn.agentCapabilities?.mcpCapabilities?.http === true,
    baseUrl: process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? '18800'}`,
  })
}

export const acpHost = {
  agents: new Map<string, AgentConnection>(),

  async startAgent(agentId: string, runtime?: string): Promise<void> {
    if (acpHost.agents.has(agentId)) {
      const conn = acpHost.agents.get(agentId)!
      if (!conn.connection.signal.aborted) return
      acpHost.agents.delete(agentId)
    }

    const agent = agentStore.get(agentId)
    if (!agent) throw new Error(`Agent 不存在: ${agentId}`)

    const effectiveRuntime = runtime || agent.runtime

    if (effectiveRuntime === 'mock') {
      await startMockAgent(agentId)
      return
    }

    const spec = RUNTIME_COMMANDS[effectiveRuntime]
    if (!spec) throw new Error(`不支持的 runtime: ${effectiveRuntime}，可用: ${Object.keys(RUNTIME_COMMANDS).join(', ')}, mock`)

    console.log(`[ACP] 正在启动 Agent ${agentId} (${effectiveRuntime})...`)

    const proc = spawn(spec.cmd, spec.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      shell: process.platform === 'win32',
    })

    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) console.error(`[ACP][${agentId}] ${text}`)
    })

    const input = Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>
    const output = Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>
    const stream = acp.ndJsonStream(input, output)

    const clientHandler = createClientHandler(agentId)
    const connection = new acp.ClientSideConnection((_agent) => clientHandler, stream)

    const initResult = await connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
        elicitation: { form: {}, url: {} },
      },
      clientInfo: { name: 'ai-ide-studio', version: '0.2.0' },
    })

    console.log(`[ACP] Agent ${agentId} 初始化成功 (protocol v${initResult.protocolVersion})`)

    const agentCaps = initResult.agentCapabilities
    console.log(`[ACP] Agent ${agentId} 能力: image=${agentCaps?.promptCapabilities?.image ?? false}, audio=${agentCaps?.promptCapabilities?.audio ?? false}, loadSession=${agentCaps?.loadSession ?? false}`)

    const conn: AgentConnection = {
      agentId,
      proc,
      connection,
      runtime: effectiveRuntime,
      acpSessions: new Map(),
      sessionCapabilities: new Map(),
      agentCapabilities: agentCaps ?? undefined,
    }
    acpHost.agents.set(agentId, conn)

    proc.on('exit', (code) => {
      console.log(`[ACP] Agent ${agentId} 进程退出，退出码: ${code}`)
      agentStore.updateStatus(agentId, 'standby')
      events.emit('agent:status', { agentId, status: 'standby' })
      acpHost.agents.delete(agentId)
    })

    agentStore.updateStatus(agentId, 'running')
    events.emit('agent:status', { agentId, status: 'running' })
  },

  async stopAgent(agentId: string): Promise<void> {
    const conn = acpHost.agents.get(agentId)
    if (!conn) return
    conn.proc.kill()
    acpHost.agents.delete(agentId)
    agentStore.updateStatus(agentId, 'standby')
    events.emit('agent:status', { agentId, status: 'standby' })
  },

  async cancelPrompt(agentId: string, ourSessionId: string): Promise<void> {
    const conn = acpHost.agents.get(agentId)
    if (!conn) return
    const acpSessionId = conn.acpSessions.get(ourSessionId)
    if (!acpSessionId) throw new Error(`Session ${ourSessionId} 没有对应的 ACP session`)

    await conn.connection.cancel({ sessionId: acpSessionId })
    cancelPendingInteractions(ourSessionId, agentId)
  },

  async newSession(agentId: string, ourSessionId: string, context: AcpSessionContext = {}): Promise<string> {
    const conn = acpHost.agents.get(agentId)
    if (!conn) throw new Error(`Agent ${agentId} 未运行`)

    const mcpServers = resolveMcpServersForAcp(conn, ourSessionId, context)

    const result = await conn.connection.newSession({
      cwd: context.cwd ?? process.cwd(),
      mcpServers,
    })

    const acpSessionId = result.sessionId
    conn.acpSessions.set(ourSessionId, acpSessionId)

    updateInitialCapabilities(conn, ourSessionId, result)

    return acpSessionId
  },

  async resumeSession(agentId: string, ourSessionId: string, acpSessionId: string, context: AcpSessionContext = {}): Promise<void> {
    const conn = acpHost.agents.get(agentId)
    if (!conn) throw new Error(`Agent ${agentId} 未运行`)
    if (conn.acpSessions.get(ourSessionId) === acpSessionId) return

    if (conn.agentCapabilities?.sessionCapabilities?.resume) {
      const mcpServers = resolveMcpServersForAcp(conn, ourSessionId, context)
      const result = await conn.connection.resumeSession({
        sessionId: acpSessionId,
        cwd: context.cwd ?? process.cwd(),
        mcpServers,
      })
      conn.acpSessions.set(ourSessionId, acpSessionId)
      updateInitialCapabilities(conn, ourSessionId, result)
      return
    }

    if (conn.agentCapabilities?.loadSession) {
      const result = await conn.connection.loadSession({
        sessionId: acpSessionId,
        cwd: context.cwd ?? process.cwd(),
        mcpServers: resolveMcpServersForAcp(conn, ourSessionId, context),
      })
      conn.acpSessions.set(ourSessionId, acpSessionId)
      updateInitialCapabilities(conn, ourSessionId, result)
      return
    }

    const newAcpSessionId = await acpHost.newSession(agentId, ourSessionId, context)
    if (newAcpSessionId !== acpSessionId) {
      console.warn(`[ACP] Agent ${agentId} 不支持恢复会话，已创建新的 ACP session: ${newAcpSessionId}`)
    }
  },

  async prompt(agentId: string, ourSessionId: string, content: string, images?: ImageAttachment[]): Promise<void> {
    const conn = acpHost.agents.get(agentId)
    if (!conn) throw new Error(`Agent ${agentId} 未运行`)

    const acpSessionId = conn.acpSessions.get(ourSessionId)
    if (!acpSessionId) throw new Error(`Session ${ourSessionId} 没有对应的 ACP session`)

    const promptBlocks: acp.ContentBlock[] = [{ type: 'text', text: content }]

    if (images && images.length > 0) {
      for (const img of images) {
        promptBlocks.push({
          type: 'image',
          data: img.data,
          mimeType: img.mimeType,
        })
      }
    }

    const promptResult = await conn.connection.prompt({
      sessionId: acpSessionId,
      prompt: promptBlocks,
    })

    let turnUsage: TurnUsageData | undefined
    if (promptResult.usage) {
      turnUsage = {
        inputTokens: promptResult.usage.inputTokens,
        outputTokens: promptResult.usage.outputTokens,
        totalTokens: promptResult.usage.totalTokens,
        cachedReadTokens: promptResult.usage.cachedReadTokens ?? undefined,
        thoughtTokens: promptResult.usage.thoughtTokens ?? undefined,
      }
    }

    events.emit('session:done', { sessionId: ourSessionId, agentId, messageId: `done-${ourSessionId}`, turnUsage, stopReason: promptResult.stopReason })
    console.log(`[ACP] Agent ${agentId} prompt 完成: ${promptResult.stopReason}${turnUsage ? ` (${turnUsage.totalTokens} tokens)` : ''}`)
  },

  async setModel(agentId: string, ourSessionId: string, modelId: string): Promise<void> {
    const conn = acpHost.agents.get(agentId)
    if (!conn) throw new Error(`Agent ${agentId} 未运行`)

    const acpSessionId = conn.acpSessions.get(ourSessionId)
    if (!acpSessionId) throw new Error(`Session ${ourSessionId} 没有对应的 ACP session`)

    try {
      await (conn.connection as unknown as { unstable_setSessionModel(p: { sessionId: string; modelId: string }): Promise<void> })
        .unstable_setSessionModel({ sessionId: acpSessionId, modelId })
      console.log(`[ACP] Agent ${agentId} 模型已切换: ${modelId}`)
    } catch (err) {
      try {
        await conn.connection.setSessionConfigOption({
          sessionId: acpSessionId,
          configId: 'model',
          value: modelId,
        })
        console.log(`[ACP] Agent ${agentId} 模型已通过 configOption 切换: ${modelId}`)
      } catch (err2) {
        throw new Error(`模型切换失败: ${(err as Error).message}, ${(err2 as Error).message}`, { cause: err2 })
      }
    }

    const caps = conn.sessionCapabilities.get(ourSessionId) || {}
    caps.currentModelId = modelId
    conn.sessionCapabilities.set(ourSessionId, caps)
    events.emit('session:capabilities', { sessionId: ourSessionId, capabilities: caps })
  },

  async setConfig(agentId: string, ourSessionId: string, configId: string, value: string | boolean): Promise<void> {
    const conn = acpHost.agents.get(agentId)
    if (!conn) throw new Error(`Agent ${agentId} 未运行`)
    const acpSessionId = conn.acpSessions.get(ourSessionId)
    if (!acpSessionId) throw new Error(`Session ${ourSessionId} 没有对应的 ACP session`)

    const result = typeof value === 'boolean'
      ? await conn.connection.setSessionConfigOption({ sessionId: acpSessionId, configId, type: 'boolean', value })
      : await conn.connection.setSessionConfigOption({ sessionId: acpSessionId, configId, value })

    const configOptions = mapConfigOptions(result.configOptions)
    const caps = mergeCapabilitiesFromConfig(conn.sessionCapabilities.get(ourSessionId) || {}, configOptions)
    conn.sessionCapabilities.set(ourSessionId, caps)
    events.emit('session:capabilities', { sessionId: ourSessionId, capabilities: caps })
    events.emit('session:update', {
      sessionId: ourSessionId,
      agentId,
      data: { messageId: `config-${Date.now()}`, role: 'system', configOptions } satisfies SessionUpdateData,
    })
  },

  async setMode(agentId: string, ourSessionId: string, modeId: string): Promise<void> {
    const conn = acpHost.agents.get(agentId)
    if (!conn) throw new Error(`Agent ${agentId} 未运行`)
    const acpSessionId = conn.acpSessions.get(ourSessionId)
    if (!acpSessionId) throw new Error(`Session ${ourSessionId} 没有对应的 ACP session`)
    await conn.connection.setSessionMode({ sessionId: acpSessionId, modeId })
    const caps = conn.sessionCapabilities.get(ourSessionId) || {}
    caps.currentModeId = modeId
    conn.sessionCapabilities.set(ourSessionId, caps)
    events.emit('session:capabilities', { sessionId: ourSessionId, capabilities: caps })
  },

  async forkSession(agentId: string, sourceSessionId: string, targetSessionId: string, context: AcpSessionContext = {}): Promise<string> {
    const conn = acpHost.agents.get(agentId)
    if (!conn) throw new Error(`Agent ${agentId} 未运行`)
    const sourceAcpSessionId = conn.acpSessions.get(sourceSessionId)
    if (!sourceAcpSessionId) throw new Error(`Session ${sourceSessionId} 没有对应的 ACP session`)
    if (!conn.agentCapabilities?.sessionCapabilities?.fork) throw new Error(`Agent ${agentId} 不支持 fork 会话`)

    const result = await conn.connection.unstable_forkSession({
      sessionId: sourceAcpSessionId,
      cwd: context.cwd ?? process.cwd(),
      mcpServers: resolveMcpServersForAcp(conn, targetSessionId, context),
    })
    conn.acpSessions.set(targetSessionId, result.sessionId)
    updateInitialCapabilities(conn, targetSessionId, result)
    return result.sessionId
  },

  getSessionCapabilities(agentId: string, ourSessionId: string): SessionCapabilities | undefined {
    return acpHost.agents.get(agentId)?.sessionCapabilities.get(ourSessionId)
  },

  async closeSession(agentId: string, ourSessionId: string): Promise<void> {
    const conn = acpHost.agents.get(agentId)
    if (!conn) return
    const acpSessionId = conn.acpSessions.get(ourSessionId)
    if (!acpSessionId) return
    try { await conn.connection.closeSession({ sessionId: acpSessionId }) } catch { /* ignore */ }
    conn.acpSessions.delete(ourSessionId)
    conn.sessionCapabilities.delete(ourSessionId)
  },

  hasAcpSession(agentId: string, ourSessionId: string): boolean {
    const conn = acpHost.agents.get(agentId)
    return conn != null && conn.acpSessions.has(ourSessionId)
  },

  isRunning(agentId: string): boolean {
    const conn = acpHost.agents.get(agentId)
    return conn != null && !conn.connection.signal.aborted
  },

  listRunning(): string[] {
    return Array.from(acpHost.agents.keys())
  },

  resolvePermission(ourSessionId: string, requestId: string, optionId?: string, cancelled?: boolean): boolean {
    const key = requestKey(ourSessionId, requestId)
    const pending = pendingPermissions.get(key)
    if (!pending) return false
    clearTimeout(pending.timeout)
    pendingPermissions.delete(key)
    pending.resolve(cancelled || !optionId ? { outcome: { outcome: 'cancelled' } } : { outcome: { outcome: 'selected', optionId } })
    return true
  },

  resolveElicitation(ourSessionId: string, requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, string | number | boolean | string[]>): boolean {
    const key = requestKey(ourSessionId, requestId)
    const pending = pendingElicitations.get(key)
    if (!pending) return false
    clearTimeout(pending.timeout)
    pendingElicitations.delete(key)
    if (action === 'accept') pending.resolve({ action, content: content ?? {} })
    else pending.resolve({ action })
    return true
  },
}


function createClientHandler(agentId: string): acp.Client {
  const turnIds = new Map<string, string>()

  function turnMessageId(acpSessionId: string, chunkMsgId?: string | null): string {
    if (chunkMsgId) { turnIds.set(acpSessionId, chunkMsgId); return chunkMsgId }
    const existing = turnIds.get(acpSessionId)
    if (existing) return existing
    const newId = `msg-${acpSessionId.slice(0, 8)}-${Date.now()}`
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
          const conn = acpHost.agents.get(agentId)
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
          const conn = acpHost.agents.get(agentId)
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
          const conn = acpHost.agents.get(agentId)
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
          const conn = acpHost.agents.get(agentId)
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
          console.log(`[ACP] 未处理的 sessionUpdate 类型: ${updateType}`)
          break
      }
    },

    async requestPermission(params) {
      const ourSessionId = findOurSessionId(agentId, params.sessionId)
      if (!ourSessionId) return { outcome: { outcome: 'cancelled' } }

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

      return new Promise<acp.RequestPermissionResponse>((resolve) => {
        const key = requestKey(ourSessionId, requestId)
        const timeout = setTimeout(() => {
          pendingPermissions.delete(key)
          events.emit('session:update', {
            sessionId: ourSessionId,
            agentId,
            data: { messageId: requestId, role: 'system', content: '', eventType: 'permission.result' } satisfies SessionUpdateData,
          })
          resolve({ outcome: { outcome: 'cancelled' } })
        }, 10 * 60 * 1000)
        pendingPermissions.set(key, { resolve, timeout, agentId, requestId })
      })
    },

    async createTerminal(params) {
      const ourSessionId = findOurSessionId(agentId, params.sessionId)
      const terminalId = `term-${randomUUID().slice(0, 8)}`
      const proc = spawn(params.command, params.args ?? [], {
        cwd: params.cwd ?? process.cwd(),
        env: {
          ...process.env,
          ...Object.fromEntries((params.env ?? []).map(item => [item.name, item.value])),
        },
        shell: process.platform === 'win32',
      })

      const term: TerminalProcess = {
        sessionId: params.sessionId,
        ourSessionId: ourSessionId ?? params.sessionId,
        proc,
        output: '',
        truncated: false,
      }
      terminals.set(terminalId, term)

      const appendOutput = (chunk: Buffer) => {
        term.output += chunk.toString()
        const limit = params.outputByteLimit ?? 200_000
        if (Buffer.byteLength(term.output, 'utf8') > limit) {
          term.output = term.output.slice(-limit)
          term.truncated = true
        }
      }
      proc.stdout?.on('data', appendOutput)
      proc.stderr?.on('data', appendOutput)
      proc.on('exit', (code, signal) => {
        term.exitCode = code
        term.signal = signal
      })

      return { terminalId }
    },

    async terminalOutput(params) {
      const term = terminals.get(params.terminalId)
      return {
        output: term?.output ?? '',
        truncated: term?.truncated ?? false,
        exitStatus: term && (term.exitCode !== undefined || term.signal !== undefined)
          ? { exitCode: term.exitCode ?? null, signal: term.signal ?? null }
          : null,
      }
    },

    async waitForTerminalExit(params) {
      const term = terminals.get(params.terminalId)
      if (!term) return { exitCode: null, signal: null }
      if (term.exitCode !== undefined || term.signal !== undefined) {
        return { exitCode: term.exitCode ?? null, signal: term.signal ?? null }
      }
      return await new Promise<acp.WaitForTerminalExitResponse>((resolve) => {
        term.proc.once('exit', (code, signal) => resolve({ exitCode: code, signal }))
      })
    },

    async killTerminal(params) {
      terminals.get(params.terminalId)?.proc.kill()
      return {}
    },

    async releaseTerminal(params) {
      const term = terminals.get(params.terminalId)
      if (term && term.exitCode === undefined && term.signal === undefined) term.proc.kill()
      terminals.delete(params.terminalId)
      return {}
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

      return new Promise<acp.CreateElicitationResponse>((resolve) => {
        const key = requestKey(ourSessionId, requestId)
        const timeout = setTimeout(() => {
          pendingElicitations.delete(key)
          events.emit('session:update', {
            sessionId: ourSessionId,
            agentId,
            data: { messageId: requestId, role: 'system', content: '', eventType: 'elicitation.result' } satisfies SessionUpdateData,
          })
          resolve({ action: 'cancel' })
        }, 10 * 60 * 1000)
        pendingElicitations.set(key, { resolve, timeout, agentId, requestId })
      })
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
        console.error(`[ACP][${agentId}] 写文件失败: ${params.path}`, err)
      }
      return {}
    },
  }
}

function cancelPendingInteractions(ourSessionId: string, agentId: string): void {
  for (const [key, pending] of pendingPermissions) {
    if (!key.startsWith(`${ourSessionId}:`)) continue
    clearTimeout(pending.timeout)
    pendingPermissions.delete(key)
    pending.resolve({ outcome: { outcome: 'cancelled' } })
    events.emit('session:update', {
      sessionId: ourSessionId,
      agentId: pending.agentId || agentId,
      data: {
        messageId: pending.requestId,
        role: 'system',
        content: '',
        eventType: 'permission.result',
      } satisfies SessionUpdateData,
    })
  }

  for (const [key, pending] of pendingElicitations) {
    if (!key.startsWith(`${ourSessionId}:`)) continue
    clearTimeout(pending.timeout)
    pendingElicitations.delete(key)
    pending.resolve({ action: 'cancel' })
    events.emit('session:update', {
      sessionId: ourSessionId,
      agentId: pending.agentId || agentId,
      data: {
        messageId: pending.requestId,
        role: 'system',
        content: '',
        eventType: 'elicitation.result',
      } satisfies SessionUpdateData,
    })
  }
}

function findLatestOurSessionId(agentId: string): string | undefined {
  const conn = acpHost.agents.get(agentId)
  if (!conn) return undefined
  return Array.from(conn.acpSessions.keys()).at(-1)
}

function findOurSessionId(agentId: string, acpSessionId: string): string | undefined {
  const conn = acpHost.agents.get(agentId)
  if (!conn) return undefined
  for (const [ourId, acpId] of conn.acpSessions) {
    if (acpId === acpSessionId) return ourId
  }
  return undefined
}

/* ─── Mock Agent ─── */

async function startMockAgent(agentId: string): Promise<void> {
  const { resolve } = await import('path')
  const mockPath = resolve(import.meta.dirname, 'mock-agent.ts')
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'

  const { AgentProcess } = await import('./process.js')
  const mockProc = new AgentProcess(npxCmd, ['tsx', mockPath], {})
  await mockProc.start()

  const acpSessions = new Map<string, string>()

  const mockConnection = {
    get signal() { return new AbortController().signal },
    async initialize() { return { protocolVersion: 1 } },
    async newSession(params: { cwd: string }) {
      const result = await mockProc.sendRequest('session/create', { workingDirectory: params.cwd })
      return { sessionId: (result as { sessionId: string }).sessionId }
    },
    async prompt(params: { sessionId: string; prompt: { type: string; text?: string }[] }) {
      const text = params.prompt.map(p => p.text || '').join('\n')
      await mockProc.sendRequest('session/prompt', { sessionId: params.sessionId, content: text })
      return { stopReason: 'end_turn' }
    },
    async cancel(params: { sessionId: string }) {
      try { await mockProc.sendRequest('session/cancel', { sessionId: params.sessionId }) } catch { /* ignore */ }
    },
    async closeSession(params: { sessionId: string }) {
      try { await mockProc.sendRequest('session/close', { sessionId: params.sessionId }) } catch { /* ignore */ }
    },
  } as unknown as acp.ClientSideConnection

  const proc = (mockProc as unknown as { proc: ChildProcess }).proc

  const conn: AgentConnection = {
    agentId, proc, connection: mockConnection, runtime: 'mock', acpSessions,
    sessionCapabilities: new Map(), agentCapabilities: undefined,
  }
  acpHost.agents.set(agentId, conn)

  mockProc.on('notification', (notification: { method: string; params?: Record<string, unknown> }) => {
    if (notification.method !== 'session/update') return
    const params = notification.params as Record<string, unknown>
    const acpSessionId = params.sessionId as string
    let ourSessionId: string | undefined
    for (const [ourId, acpId] of conn.acpSessions) {
      if (acpId === acpSessionId) { ourSessionId = ourId; break }
    }
    if (!ourSessionId) return
    handleMockNotification(agentId, ourSessionId, params)
  })

  mockProc.on('exit', (code: number) => {
    console.log(`[ACP] Mock Agent ${agentId} 进程退出: ${code}`)
    agentStore.updateStatus(agentId, 'standby')
    events.emit('agent:status', { agentId, status: 'standby' })
    acpHost.agents.delete(agentId)
  })

  agentStore.updateStatus(agentId, 'running')
  events.emit('agent:status', { agentId, status: 'running' })
  console.log(`[ACP] Mock Agent ${agentId} 初始化成功`)
}

function handleMockNotification(agentId: string, ourSessionId: string, params: Record<string, unknown>) {
  const updateType = params.type as string
  const messageId = (params.messageId as string) || `msg-${Date.now()}`
  const data: SessionUpdateData = { messageId, role: 'agent' }

  switch (updateType) {
    case 'content_block_start': {
      const block = params.contentBlock as Record<string, unknown>
      if (block?.type === 'thinking') data.thinking = (block.thinking as string) || ''
      break
    }
    case 'content_block_delta': {
      const delta = params.delta as Record<string, unknown>
      if (delta?.text) data.contentDelta = delta.text as string
      break
    }
    case 'message_done':
      data.done = true
      events.emit('session:done', { sessionId: ourSessionId, agentId, messageId, stopReason: 'end_turn' })
      return
    default:
      return
  }
  events.emit('session:update', { sessionId: ourSessionId, agentId, data })
}
