import { spawn, type ChildProcess } from 'child_process'
import { Writable, Readable } from 'stream'
import * as acp from '@agentclientprotocol/sdk'
import { events } from '../core/events.js'
import { agentStore } from '../store/agents.js'
import type { SessionUpdateData, ToolCallData, ToolCallContentItem, TurnUsageData, SessionCapabilities, ModelInfo, ModeInfo, ImageAttachment } from '../types/ws-protocol.js'

interface AgentConnection {
  agentId: string
  proc: ChildProcess
  connection: acp.ClientSideConnection
  runtime: string
  acpSessions: Map<string, string>
  sessionCapabilities: Map<string, SessionCapabilities>
  agentCapabilities?: acp.AgentCapabilities
}

const RUNTIME_COMMANDS: Record<string, { cmd: string; args: string[] }> = {
  claude: { cmd: process.platform === 'win32' ? 'npx.cmd' : 'npx', args: ['claude-agent-acp'] },
  codex: { cmd: process.platform === 'win32' ? 'npx.cmd' : 'npx', args: ['codex-acp'] },
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
      },
    })

    console.log(`[ACP] Agent ${agentId} 初始化成功 (protocol v${initResult.protocolVersion})`)

    const agentCaps = initResult.capabilities
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

  async newSession(agentId: string, ourSessionId: string): Promise<string> {
    const conn = acpHost.agents.get(agentId)
    if (!conn) throw new Error(`Agent ${agentId} 未运行`)

    const result = await conn.connection.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    })

    const acpSessionId = result.sessionId
    conn.acpSessions.set(ourSessionId, acpSessionId)

    const caps: SessionCapabilities = {}
    if (result.models) {
      caps.models = result.models.availableModels.map(m => ({
        modelId: m.modelId,
        name: m.name,
        description: m.description ?? undefined,
      }))
      caps.currentModelId = result.models.currentModelId
    }

    if (conn.agentCapabilities?.promptCapabilities) {
      caps.supportsImages = conn.agentCapabilities.promptCapabilities.image ?? false
      caps.supportsAudio = conn.agentCapabilities.promptCapabilities.audio ?? false
    }

    if (result.modes) {
      caps.modes = result.modes.availableModes.map(m => ({ modeId: m.modeId, name: m.name, description: m.description ?? undefined }))
      caps.currentModeId = result.modes.currentModeId
    }

    conn.sessionCapabilities.set(ourSessionId, caps)
    events.emit('session:capabilities', { sessionId: ourSessionId, capabilities: caps })

    return acpSessionId
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

    events.emit('session:done', { sessionId: ourSessionId, agentId, messageId: `done-${ourSessionId}`, turnUsage })
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
          configOption: { type: 'select', id: 'model', name: 'Model', value: modelId, options: [] },
        })
        console.log(`[ACP] Agent ${agentId} 模型已通过 configOption 切换: ${modelId}`)
      } catch (err2) {
        throw new Error(`模型切换失败: ${(err as Error).message}, ${(err2 as Error).message}`)
      }
    }

    const caps = conn.sessionCapabilities.get(ourSessionId) || {}
    caps.currentModelId = modelId
    conn.sessionCapabilities.set(ourSessionId, caps)
    events.emit('session:capabilities', { sessionId: ourSessionId, capabilities: caps })
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
}

function mapToolCallContent(items?: acp.ToolCallContent[]): ToolCallContentItem[] | undefined {
  if (!items || items.length === 0) return undefined
  return items.map(item => {
    if (item.type === 'diff') {
      const d = item as acp.Diff & { type: string }
      return { type: 'diff' as const, path: d.path, oldText: d.oldText ?? undefined, newText: d.newText }
    }
    if (item.type === 'terminal') {
      const t = item as acp.Terminal & { type: string }
      return { type: 'terminal' as const, terminalId: t.terminalId }
    }
    const c = item as acp.Content & { type: string }
    const block = c.content
    return { type: 'text' as const, text: block.type === 'text' ? (block as acp.TextContent).text : JSON.stringify(block) }
  })
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
          let title = tc.title
          if (!title && tc.locations?.[0]) title = tc.locations[0].path.split(/[/\\]/).pop() || ''
          if (!title && tc.rawInput && typeof tc.rawInput === 'object') {
            const inp = tc.rawInput as Record<string, unknown>
            title = (inp.command && `执行 ${String(inp.command).slice(0, 60)}`) || (inp.path && String(inp.path).split(/[/\\]/).pop()) || (inp.file_path && String(inp.file_path).split(/[/\\]/).pop()) || ''
          }
          const toolData: ToolCallData = {
            id: tc.toolCallId,
            title: title || '',
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
          const toolData: ToolCallData = {
            id: tcu.toolCallId,
            title: tcu.title ?? '',
            kind: tcu.kind ?? undefined,
            status: tcu.status ?? undefined,
            locations: tcu.locations?.map(l => ({ path: l.path, line: l.line ?? undefined })),
            rawInput: tcu.rawInput,
            rawOutput: tcu.rawOutput,
            content: mapToolCallContent(tcu.content ?? undefined),
          }
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
          const modelOpt = cou.configOptions.find(o => o.category === 'model')
          if (modelOpt && modelOpt.type === 'select') {
            const conn = acpHost.agents.get(agentId)
            if (conn) {
              const caps = conn.sessionCapabilities.get(ourSessionId) || {}
              caps.currentModelId = (modelOpt as acp.SessionConfigSelect & { type: string; id: string; name: string }).value
              const selectOpt = modelOpt as acp.SessionConfigSelect & { type: string; id: string; name: string }
              caps.models = selectOpt.options.map(o => ({ modelId: o.value, name: o.label }))
              conn.sessionCapabilities.set(ourSessionId, caps)
              events.emit('session:capabilities', { sessionId: ourSessionId, capabilities: caps })
            }
          }
          break
        }
        case 'session_info_update': {
          const siu = update as acp.SessionInfoUpdate & { sessionUpdate: string }
          if (siu.title) {
            console.log(`[ACP] Session ${ourSessionId} title: ${siu.title}`)
          }
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
        case 'available_commands_update':
        case 'user_message_chunk':
          break
        default:
          console.log(`[ACP] 未处理的 sessionUpdate 类型: ${updateType}`)
          break
      }
    },

    async requestPermission(params) {
      console.log(`[ACP][${agentId}] 权限请求: ${params.toolCall.title}`)
      const allowOption = params.options.find(o => o.kind === 'allow_once' || o.kind === 'allow_always')
      if (allowOption) {
        return { outcome: { outcome: 'selected', optionId: allowOption.optionId } }
      }
      return { outcome: { outcome: 'selected', optionId: params.options[0].optionId } }
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
    async prompt(params: { sessionId: string; prompt: { type: string; text: string }[] }) {
      const text = params.prompt.map(p => p.text).join('\n')
      await mockProc.sendRequest('session/prompt', { sessionId: params.sessionId, content: text })
      return { stopReason: 'end_turn' }
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
      events.emit('session:done', { sessionId: ourSessionId, agentId, messageId })
      return
    default:
      return
  }
  events.emit('session:update', { sessionId: ourSessionId, agentId, data })
}
