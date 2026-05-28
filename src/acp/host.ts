import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { Writable, Readable } from 'stream'
import * as acp from '@agentclientprotocol/sdk'
import { events } from '../core/events.js'
import { createChildLogger } from '../core/logger.js'
import { agentStore } from '../store/agents.js'
import type { ElicitationRequestData, PermissionRequestData, SessionInfoData, SessionUpdateData, ToolCallData, TurnUsageData, SessionCapabilities, ImageAttachment } from '../types/ws-protocol.js'
import { resolveToolsAsMcpServers } from '../tools/resolver.js'
import { mapAvailableCommands, mapConfigOptions, mergeCapabilitiesFromConfig } from './capabilities.js'
import { buildRuntimeEnv, getRuntimeCommand, listRuntimeNames } from './runtime-registry.js'
import { contentBlockToText, mapToolCallContent, mapToolCallUpdate, toolCallTitle } from './update-mapper.js'

type RuntimeState = 'starting' | 'running' | 'stopping' | 'stopped'
type AcpSessionState = 'connecting' | 'connected' | 'closing' | 'disconnected'

interface RuntimeSessionState {
  ourSessionId: string
  acpSessionId?: string
  state: AcpSessionState
  lastUsedAt: number
  activeTurnCount: number
  connectPromise?: Promise<string>
}

interface AgentConnection {
  agentId: string
  proc: ChildProcess
  connection: acp.ClientSideConnection
  runtime: string
  acpSessions: Map<string, string>
  runtimeSessions: Map<string, RuntimeSessionState>
  sessionCapabilities: Map<string, SessionCapabilities>
  state: RuntimeState
  lastUsedAt: number
  activeTurnCount: number
  agentCapabilities?: acp.AgentCapabilities
}

interface AcpSessionContext {
  projectId?: string
  cwd?: string
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
const startPromises = new Map<string, Promise<void>>()
const log = createChildLogger('acp-host')

const ACP_SESSION_IDLE_MS = readPositiveMs(process.env.ACP_SESSION_IDLE_MS, 30 * 60 * 1000)
const ACP_RUNTIME_IDLE_MS = readPositiveMs(process.env.ACP_RUNTIME_IDLE_MS, 60 * 60 * 1000)
const ACP_IDLE_SWEEP_MS = readPositiveMs(process.env.ACP_IDLE_SWEEP_MS, 5 * 60 * 1000)
let idleTimer: ReturnType<typeof setInterval> | null = null

function requestKey(sessionId: string, requestId: string): string {
  return `${sessionId}:${requestId}`
}

function readPositiveMs(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
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

function createConnectionState(
  agentId: string,
  runtime: string,
  proc: ChildProcess,
  connection: acp.ClientSideConnection,
  agentCapabilities?: acp.AgentCapabilities,
): AgentConnection {
  const now = Date.now()
  return {
    agentId,
    proc,
    connection,
    runtime,
    acpSessions: new Map(),
    runtimeSessions: new Map(),
    sessionCapabilities: new Map(),
    state: 'running',
    lastUsedAt: now,
    activeTurnCount: 0,
    agentCapabilities,
  }
}

function getRuntimeSession(conn: AgentConnection, ourSessionId: string): RuntimeSessionState {
  let state = conn.runtimeSessions.get(ourSessionId)
  if (!state) {
    state = {
      ourSessionId,
      acpSessionId: conn.acpSessions.get(ourSessionId),
      state: conn.acpSessions.has(ourSessionId) ? 'connected' : 'disconnected',
      lastUsedAt: Date.now(),
      activeTurnCount: 0,
    }
    conn.runtimeSessions.set(ourSessionId, state)
  }
  return state
}

function markSessionConnected(conn: AgentConnection, ourSessionId: string, acpSessionId: string): void {
  const now = Date.now()
  conn.acpSessions.set(ourSessionId, acpSessionId)
  const session = getRuntimeSession(conn, ourSessionId)
  session.acpSessionId = acpSessionId
  session.state = 'connected'
  session.lastUsedAt = now
  session.connectPromise = undefined
  conn.lastUsedAt = now
}

function touchRuntime(conn: AgentConnection, ourSessionId?: string): void {
  const now = Date.now()
  conn.lastUsedAt = now
  if (ourSessionId) getRuntimeSession(conn, ourSessionId).lastUsedAt = now
}

function beginTurn(conn: AgentConnection, ourSessionId: string): void {
  const session = getRuntimeSession(conn, ourSessionId)
  if (session.activeTurnCount > 0) {
    throw new Error('当前会话正在生成中，请等待本轮完成或先停止生成')
  }
  session.activeTurnCount += 1
  conn.activeTurnCount += 1
  touchRuntime(conn, ourSessionId)
}

function endTurn(conn: AgentConnection, ourSessionId: string): void {
  const session = getRuntimeSession(conn, ourSessionId)
  session.activeTurnCount = Math.max(0, session.activeTurnCount - 1)
  conn.activeTurnCount = Math.max(0, conn.activeTurnCount - 1)
  touchRuntime(conn, ourSessionId)
}

function emitLifecycle(agentId: string, ourSessionId: string, eventType: string, content: string): void {
  events.emit('session:update', {
    sessionId: ourSessionId,
    agentId,
    data: {
      messageId: `${eventType}-${Date.now()}`,
      role: 'system',
      content,
      eventType,
    } satisfies SessionUpdateData,
  })
}

function hasPendingInteractionsForSession(ourSessionId: string): boolean {
  const prefix = `${ourSessionId}:`
  return [...pendingPermissions.keys()].some(key => key.startsWith(prefix)) ||
    [...pendingElicitations.keys()].some(key => key.startsWith(prefix))
}

function hasPendingInteractionsForAgent(agentId: string): boolean {
  return [...pendingPermissions.values()].some(pending => pending.agentId === agentId) ||
    [...pendingElicitations.values()].some(pending => pending.agentId === agentId)
}

function ensureIdleTimer(): void {
  if (idleTimer || ACP_IDLE_SWEEP_MS <= 0) return
  idleTimer = setInterval(() => {
    acpHost.sweepIdle().catch(err => log.warn({ err }, 'ACP 空闲回收失败'))
  }, ACP_IDLE_SWEEP_MS)
  idleTimer.unref?.()
}

export const acpHost = {
  agents: new Map<string, AgentConnection>(),

  async startAgent(agentId: string, runtime?: string): Promise<void> {
    const existing = acpHost.agents.get(agentId)
    if (existing && !existing.connection.signal.aborted) {
      touchRuntime(existing)
      return
    }
    if (existing) acpHost.agents.delete(agentId)

    const pendingStart = startPromises.get(agentId)
    if (pendingStart) return pendingStart

    const promise = acpHost.startAgentInternal(agentId, runtime)
      .finally(() => startPromises.delete(agentId))
    startPromises.set(agentId, promise)
    return promise
  },

  async startAgentInternal(agentId: string, runtime?: string): Promise<void> {
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
      ensureIdleTimer()
      return
    }

    const spec = getRuntimeCommand(effectiveRuntime)
    if (!spec) throw new Error(`不支持的 runtime: ${effectiveRuntime}，可用: ${listRuntimeNames().join(', ')}, mock`)

    log.info({ agentId, runtime: effectiveRuntime }, '正在启动 Agent runtime')

    const proc = spawn(spec.cmd, spec.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildRuntimeEnv(effectiveRuntime),
      shell: process.platform === 'win32',
    })

    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) log.warn({ agentId, runtime: effectiveRuntime, stderr: text }, 'Agent runtime stderr')
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

    log.info({ agentId, runtime: effectiveRuntime, protocolVersion: initResult.protocolVersion }, 'Agent runtime 初始化成功')

    const agentCaps = initResult.agentCapabilities
    log.info({
      agentId,
      runtime: effectiveRuntime,
      image: agentCaps?.promptCapabilities?.image ?? false,
      audio: agentCaps?.promptCapabilities?.audio ?? false,
      loadSession: agentCaps?.loadSession ?? false,
    }, 'Agent runtime 能力')

    const conn = createConnectionState(agentId, effectiveRuntime, proc, connection, agentCaps ?? undefined)
    acpHost.agents.set(agentId, conn)

    proc.on('exit', (code) => {
      conn.state = 'stopped'
      log.info({ agentId, runtime: effectiveRuntime, code }, 'Agent runtime 进程退出')
      agentStore.updateStatus(agentId, 'standby')
      events.emit('agent:status', { agentId, status: 'standby' })
      acpHost.agents.delete(agentId)
    })

    agentStore.updateStatus(agentId, 'running')
    events.emit('agent:status', { agentId, status: 'running' })
    ensureIdleTimer()
  },

  async stopAgent(agentId: string): Promise<void> {
    const conn = acpHost.agents.get(agentId)
    if (!conn) return
    conn.state = 'stopping'
    conn.proc.kill()
    acpHost.agents.delete(agentId)
    agentStore.updateStatus(agentId, 'standby')
    events.emit('agent:status', { agentId, status: 'standby' })
    log.info({ agentId, runtime: conn.runtime }, 'Agent runtime 已停止')
  },

  async cancelPrompt(agentId: string, ourSessionId: string): Promise<void> {
    const conn = acpHost.agents.get(agentId)
    if (!conn) return
    const acpSessionId = conn.acpSessions.get(ourSessionId)
    if (!acpSessionId) throw new Error(`Session ${ourSessionId} 没有对应的 ACP session`)

    await conn.connection.cancel({ sessionId: acpSessionId })
    cancelPendingInteractions(ourSessionId, agentId)
    const state = getRuntimeSession(conn, ourSessionId)
    state.activeTurnCount = 0
    conn.activeTurnCount = Math.max(0, [...conn.runtimeSessions.values()].reduce((sum, item) => sum + item.activeTurnCount, 0))
    touchRuntime(conn, ourSessionId)
  },

  async ensureSession(agentId: string, ourSessionId: string, persistedAcpSessionId?: string | null, context: AcpSessionContext = {}): Promise<string> {
    const existed = acpHost.isRunning(agentId)
    if (!existed) emitLifecycle(agentId, ourSessionId, 'lifecycle.runtime_starting', '\u6b63\u5728\u542f\u52a8 Agent...')
    await acpHost.startAgent(agentId)
    const conn = acpHost.agents.get(agentId)
    if (!conn) throw new Error(`Agent ${agentId} not running`)
    if (!existed) emitLifecycle(agentId, ourSessionId, 'lifecycle.runtime_ready', 'Agent \u5df2\u5c31\u7eea')

    const existingAcpSessionId = conn.acpSessions.get(ourSessionId)
    if (existingAcpSessionId) {
      markSessionConnected(conn, ourSessionId, existingAcpSessionId)
      return existingAcpSessionId
    }

    const state = getRuntimeSession(conn, ourSessionId)
    if (state.connectPromise) return state.connectPromise

    state.state = 'connecting'
    state.connectPromise = (async () => {
      try {
        let acpSessionId: string
        if (persistedAcpSessionId) {
          emitLifecycle(agentId, ourSessionId, 'lifecycle.session_resuming', '\u6b63\u5728\u6062\u590d\u4f1a\u8bdd...')
          await acpHost.resumeSession(agentId, ourSessionId, persistedAcpSessionId, context)
          acpSessionId = conn.acpSessions.get(ourSessionId) ?? persistedAcpSessionId
        } else {
          emitLifecycle(agentId, ourSessionId, 'lifecycle.session_creating', '\u6b63\u5728\u8fde\u63a5\u4f1a\u8bdd...')
          acpSessionId = await acpHost.newSession(agentId, ourSessionId, context)
        }
        markSessionConnected(conn, ourSessionId, acpSessionId)
        emitLifecycle(agentId, ourSessionId, 'lifecycle.session_ready', '\u4f1a\u8bdd\u5df2\u8fde\u63a5')
        return acpSessionId
      } catch (err) {
        state.state = 'disconnected'
        state.connectPromise = undefined
        emitLifecycle(agentId, ourSessionId, 'lifecycle.failed', `\u8fde\u63a5\u5931\u8d25\uff1a${err instanceof Error ? err.message : String(err)}`)
        throw err
      }
    })()
    return state.connectPromise
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
    markSessionConnected(conn, ourSessionId, acpSessionId)

    updateInitialCapabilities(conn, ourSessionId, result)

    return acpSessionId
  },

  async resumeSession(agentId: string, ourSessionId: string, acpSessionId: string, context: AcpSessionContext = {}): Promise<string> {
    const conn = acpHost.agents.get(agentId)
    if (!conn) throw new Error(`Agent ${agentId} 未运行`)
    if (conn.acpSessions.get(ourSessionId) === acpSessionId) return acpSessionId

    if (conn.agentCapabilities?.sessionCapabilities?.resume) {
      const mcpServers = resolveMcpServersForAcp(conn, ourSessionId, context)
      const result = await conn.connection.resumeSession({
        sessionId: acpSessionId,
        cwd: context.cwd ?? process.cwd(),
        mcpServers,
      })
      markSessionConnected(conn, ourSessionId, acpSessionId)
      updateInitialCapabilities(conn, ourSessionId, result)
      return acpSessionId
    }

    if (conn.agentCapabilities?.loadSession) {
      const result = await conn.connection.loadSession({
        sessionId: acpSessionId,
        cwd: context.cwd ?? process.cwd(),
        mcpServers: resolveMcpServersForAcp(conn, ourSessionId, context),
      })
      markSessionConnected(conn, ourSessionId, acpSessionId)
      updateInitialCapabilities(conn, ourSessionId, result)
      return acpSessionId
    }

    const newAcpSessionId = await acpHost.newSession(agentId, ourSessionId, context)
    if (newAcpSessionId !== acpSessionId) {
      log.warn({ agentId, ourSessionId, requestedAcpSessionId: acpSessionId, newAcpSessionId }, 'Agent 不支持恢复会话，已创建新的 ACP session')
    }
    return newAcpSessionId
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

    beginTurn(conn, ourSessionId)
    try {
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
      log.info({ agentId, ourSessionId, stopReason: promptResult.stopReason, totalTokens: turnUsage?.totalTokens }, 'Agent prompt completed')
    } finally {
      endTurn(conn, ourSessionId)
    }
  },

  async setModel(agentId: string, ourSessionId: string, modelId: string): Promise<void> {
    const conn = acpHost.agents.get(agentId)
    if (!conn) throw new Error(`Agent ${agentId} 未运行`)

    const acpSessionId = conn.acpSessions.get(ourSessionId)
    if (!acpSessionId) throw new Error(`Session ${ourSessionId} 没有对应的 ACP session`)

    try {
      await conn.connection.unstable_setSessionModel({ sessionId: acpSessionId, modelId })
      log.info({ agentId, ourSessionId, modelId }, '模型已切换')
    } catch (err) {
      try {
        await conn.connection.setSessionConfigOption({
          sessionId: acpSessionId,
          configId: 'model',
          value: modelId,
        })
        log.info({ agentId, ourSessionId, modelId }, '模型已通过 configOption 切换')
      } catch (err2) {
        throw new Error(`模型切换失败: ${(err as Error).message}, ${(err2 as Error).message}`, { cause: err2 })
      }
    }

    const caps = conn.sessionCapabilities.get(ourSessionId) || {}
    caps.currentModelId = modelId
    conn.sessionCapabilities.set(ourSessionId, caps)
    events.emit('session:capabilities', { sessionId: ourSessionId, capabilities: caps })
    touchRuntime(conn, ourSessionId)
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
    touchRuntime(conn, ourSessionId)
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
    touchRuntime(conn, ourSessionId)
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
    markSessionConnected(conn, targetSessionId, result.sessionId)
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
    const sessionState = getRuntimeSession(conn, ourSessionId)
    if (!acpSessionId) {
      conn.runtimeSessions.delete(ourSessionId)
      conn.sessionCapabilities.delete(ourSessionId)
      return
    }
    sessionState.state = 'closing'
    try {
      await conn.connection.closeSession({ sessionId: acpSessionId })
    } catch (err) {
      log.debug({ err, agentId, ourSessionId, acpSessionId }, 'ACP session close best-effort 失败')
    }
    conn.acpSessions.delete(ourSessionId)
    conn.sessionCapabilities.delete(ourSessionId)
    conn.runtimeSessions.delete(ourSessionId)
    touchRuntime(conn)
  },

  async sweepIdle(now = Date.now()): Promise<void> {
    for (const [agentId, conn] of [...acpHost.agents]) {
      for (const session of [...conn.runtimeSessions.values()]) {
        if (session.state !== 'connected') continue
        if (session.activeTurnCount > 0) continue
        if (hasPendingInteractionsForSession(session.ourSessionId)) continue
        if (now - session.lastUsedAt <= ACP_SESSION_IDLE_MS) continue

        await acpHost.closeSession(agentId, session.ourSessionId)
        emitLifecycle(agentId, session.ourSessionId, 'lifecycle.session_disconnected', '\u4f1a\u8bdd\u5df2\u56e0\u7a7a\u95f2\u65ad\u5f00\uff0c\u4e0b\u6b21\u53d1\u9001\u65f6\u4f1a\u81ea\u52a8\u6062\u590d')
      }

      if (conn.activeTurnCount > 0) continue
      if (conn.acpSessions.size > 0) continue
      if (hasPendingInteractionsForAgent(agentId)) continue
      if (now - conn.lastUsedAt <= ACP_RUNTIME_IDLE_MS) continue

      await acpHost.stopAgent(agentId)
      log.info({ agentId, runtime: conn.runtime }, 'Agent runtime 空闲回收')
    }
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
          log.debug({ agentId, updateType }, '未处理的 sessionUpdate 类型')
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
        log.error({ err, agentId, path: params.path }, '写文件失败')
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

  const conn = createConnectionState(agentId, 'mock', proc, mockConnection, undefined)
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
    conn.state = 'stopped'
    log.info({ agentId, code }, 'Mock Agent 进程退出')
    agentStore.updateStatus(agentId, 'standby')
    events.emit('agent:status', { agentId, status: 'standby' })
    acpHost.agents.delete(agentId)
  })

  agentStore.updateStatus(agentId, 'running')
  events.emit('agent:status', { agentId, status: 'running' })
  ensureIdleTimer()
  log.info({ agentId }, 'Mock Agent 初始化成功')
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
