import { spawn, type ChildProcess } from 'child_process'
import { Writable, Readable } from 'stream'
import * as acp from '@agentclientprotocol/sdk'
import { events } from '../core/events.js'
import { createChildLogger } from '../core/logger.js'
import { agentStore } from '../store/agents.js'
import { sessionStore } from '../store/sessions.js'
import type { SessionUpdateData, TurnUsageData, SessionCapabilities, ImageAttachment } from '../types/ws-protocol.js'
import { mapConfigOptions, mergeCapabilitiesFromConfig } from './capabilities.js'
import { createClientHandler, endClientTurn, getClientTurnMessageId, startClientTurn } from './client-handler.js'
import {
  acpSessionContextKey,
  agentConnections,
  beginTurn,
  createConnectionState,
  endTurn,
  getRuntimeSession,
  markSessionConnected,
  touchRuntime,
} from './host-state.js'
import type { AcpSessionContext } from './host-types.js'
import {
  cancelPendingInteractions,
  hasPendingInteractionsForAgent,
  hasPendingInteractionsForSession,
  resolveElicitation,
  resolvePermission,
} from './interaction-state.js'
import {
  buildAgentSessionMeta,
  buildAgentRuntimeEnv,
  fingerprintRuntimeEnv,
  summarizeRuntimeEnv,
} from './model-profile-env.js'
import { buildRuntimeEnv, getRuntimeCommand, listRuntimeNames } from './runtime-registry.js'
import { resolveMcpServersForAcp, updateInitialCapabilities } from './session-capabilities.js'
import { applySessionRuntimePreferences, emitRuntimePreferencesApplied } from './session-runtime-preferences.js'

const startPromises = new Map<string, Promise<void>>()
const cancelledSessions = new Set<string>()
const log = createChildLogger('acp-host')

interface PromptDiagnosticsOptions {
  turnId?: string
  messageId?: string
}

const ACP_SESSION_IDLE_MS = readPositiveMs(process.env.ACP_SESSION_IDLE_MS, 30 * 60 * 1000)
const ACP_RUNTIME_IDLE_MS = readPositiveMs(process.env.ACP_RUNTIME_IDLE_MS, 60 * 60 * 1000)
const ACP_IDLE_SWEEP_MS = readPositiveMs(process.env.ACP_IDLE_SWEEP_MS, 5 * 60 * 1000)
let idleTimer: ReturnType<typeof setInterval> | null = null
const MOCK_MODELS = [
  { modelId: 'mock-fast', name: 'Mock Fast', description: '本地快速测试模型' },
  { modelId: 'mock-smart', name: 'Mock Smart', description: '本地能力测试模型' },
]
const MOCK_MODES = [
  { id: 'default', name: '执行模式', description: '直接执行用户请求' },
  { id: 'plan', name: 'PLAN 模式', description: '先给出计划，再等待切换执行' },
]

function readPositiveMs(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
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

function ensureIdleTimer(): void {
  if (idleTimer || ACP_IDLE_SWEEP_MS <= 0) return
  idleTimer = setInterval(() => {
    acpHost.sweepIdle().catch((err) => log.warn({ err }, 'ACP 空闲回收失败'))
  }, ACP_IDLE_SWEEP_MS)
  idleTimer.unref?.()
}

export const acpHost = {
  agents: agentConnections,

  async startAgent(agentId: string, runtime?: string): Promise<void> {
    const pendingStart = startPromises.get(agentId)
    if (pendingStart) return pendingStart

    const promise = acpHost.startAgentInternal(agentId, runtime).finally(() => startPromises.delete(agentId))
    startPromises.set(agentId, promise)
    return promise
  },

  async startAgentInternal(agentId: string, runtime?: string): Promise<void> {
    const stale = acpHost.agents.get(agentId)
    if (stale?.connection.signal.aborted) acpHost.agents.delete(agentId)

    const agent = agentStore.get(agentId)
    if (!agent) throw new Error(`Agent 不存在: ${agentId}`)

    const effectiveRuntime = runtime || agent.runtime
    const runtimeEnv = effectiveRuntime === 'mock'
      ? { env: buildRuntimeEnv(effectiveRuntime), appliedProfile: undefined }
      : buildAgentRuntimeEnv(effectiveRuntime, agent)
    const sessionMeta = buildAgentSessionMeta(effectiveRuntime, runtimeEnv.env, agent)
    const envFingerprint = fingerprintRuntimeEnv(runtimeEnv.env, effectiveRuntime)
    const existing = acpHost.agents.get(agentId)
    if (existing && !existing.connection.signal.aborted) {
      if (existing.runtime === effectiveRuntime && existing.envFingerprint === envFingerprint) {
        existing.sessionMeta = sessionMeta
        touchRuntime(existing)
        return
      }
      log.info({ agentId, runtime: effectiveRuntime }, 'Agent runtime 配置已变化，正在重启')
      await acpHost.stopAgent(agentId)
    } else if (existing) {
      acpHost.agents.delete(agentId)
    }

    if (effectiveRuntime === 'mock') {
      await startMockAgent(agentId, envFingerprint)
      ensureIdleTimer()
      return
    }

    const spec = getRuntimeCommand(effectiveRuntime)
    if (!spec) throw new Error(`不支持的 runtime: ${effectiveRuntime}，可用: ${listRuntimeNames().join(', ')}, mock`)

    log.info(
      {
        agentId,
        runtime: effectiveRuntime,
        modelProfileId: runtimeEnv.appliedProfile?.id,
        runtimeEnv: summarizeRuntimeEnv(runtimeEnv.env, effectiveRuntime),
      },
      '正在启动 Agent runtime',
    )

    const proc = spawn(spec.cmd, spec.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: runtimeEnv.env,
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

    log.info(
      { agentId, runtime: effectiveRuntime, protocolVersion: initResult.protocolVersion },
      'Agent runtime 初始化成功',
    )

    const agentCaps = initResult.agentCapabilities
    log.info(
      {
        agentId,
        runtime: effectiveRuntime,
        image: agentCaps?.promptCapabilities?.image ?? false,
        audio: agentCaps?.promptCapabilities?.audio ?? false,
        loadSession: agentCaps?.loadSession ?? false,
      },
      'Agent runtime 能力',
    )

    const conn = createConnectionState(
      agentId,
      effectiveRuntime,
      proc,
      connection,
      agentCaps ?? undefined,
      envFingerprint,
      sessionMeta,
      runtimeEnv.env,
      agent,
    )
    acpHost.agents.set(agentId, conn)

    proc.on('exit', (code) => {
      conn.state = 'stopped'
      log.info({ agentId, runtime: effectiveRuntime, code }, 'Agent runtime 进程退出')

      for (const [ourSessionId, sessionState] of conn.runtimeSessions) {
        if (sessionState.activeTurnCount > 0) {
          log.warn({ agentId, ourSessionId, code }, 'Agent 进程退出时存在活跃 prompt，强制结束')
          events.emit('session:done', {
            sessionId: ourSessionId,
            agentId,
            messageId: `exit-${Date.now()}`,
            stopReason: 'error',
            error: `Agent 进程意外退出 (code=${code})`,
          })
        }
        cancelPendingInteractions(ourSessionId, agentId)
      }

      if (acpHost.agents.get(agentId) === conn) {
        agentStore.updateStatus(agentId, 'standby')
        events.emit('agent:status', { agentId, status: 'standby' })
        acpHost.agents.delete(agentId)
      }
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

    cancelledSessions.add(ourSessionId)
    try {
      await conn.connection.cancel({ sessionId: acpSessionId })
    } catch (err) {
      log.debug({ err, agentId, ourSessionId }, 'ACP cancel best-effort 失败')
    }
    cancelPendingInteractions(ourSessionId, agentId)
    touchRuntime(conn, ourSessionId)
  },

  async ensureSession(
    agentId: string,
    ourSessionId: string,
    persistedAcpSessionId?: string | null,
    context: AcpSessionContext = {},
  ): Promise<string> {
    const showLifecycle = context.emitLifecycle !== false
    const existed = acpHost.isRunning(agentId)
    if (!existed && showLifecycle)
      emitLifecycle(agentId, ourSessionId, 'lifecycle.runtime_starting', '\u6b63\u5728\u542f\u52a8 Agent...')
    await acpHost.startAgent(agentId)
    const conn = acpHost.agents.get(agentId)
    if (!conn) throw new Error(`Agent ${agentId} not running`)
    if (!existed && showLifecycle) emitLifecycle(agentId, ourSessionId, 'lifecycle.runtime_ready', 'Agent \u5df2\u5c31\u7eea')

    const state = getRuntimeSession(conn, ourSessionId)
    const existingAcpSessionId = conn.acpSessions.get(ourSessionId)
    const nextContextKey = acpSessionContextKey(context)
    if (existingAcpSessionId && state.contextKey === nextContextKey) {
      markSessionConnected(conn, ourSessionId, existingAcpSessionId, context)
      return existingAcpSessionId
    }
    if (state.connectPromise) return state.connectPromise

    state.state = 'connecting'
    state.connectPromise = (async () => {
      try {
        let acpSessionId: string
        const acpSessionIdToResume = persistedAcpSessionId ?? existingAcpSessionId
        if (acpSessionIdToResume) {
          if (showLifecycle) emitLifecycle(agentId, ourSessionId, 'lifecycle.session_resuming', '\u6b63\u5728\u6062\u590d\u4f1a\u8bdd...')
          await acpHost.resumeSession(agentId, ourSessionId, acpSessionIdToResume, context)
          acpSessionId = conn.acpSessions.get(ourSessionId) ?? acpSessionIdToResume
        } else {
          if (showLifecycle) emitLifecycle(agentId, ourSessionId, 'lifecycle.session_creating', '\u6b63\u5728\u8fde\u63a5\u4f1a\u8bdd...')
          acpSessionId = await acpHost.newSession(agentId, ourSessionId, context)
        }
        markSessionConnected(conn, ourSessionId, acpSessionId, context)
        if (showLifecycle) emitLifecycle(agentId, ourSessionId, 'lifecycle.session_ready', '\u4f1a\u8bdd\u5df2\u8fde\u63a5')
        return acpSessionId
      } catch (err) {
        state.state = 'disconnected'
        state.connectPromise = undefined
        if (showLifecycle) {
          emitLifecycle(
            agentId,
            ourSessionId,
            'lifecycle.failed',
            `\u8fde\u63a5\u5931\u8d25\uff1a${err instanceof Error ? err.message : String(err)}`,
          )
        }
        throw err
      }
    })()
    return state.connectPromise
  },

  async newSession(agentId: string, ourSessionId: string, context: AcpSessionContext = {}): Promise<string> {
    const conn = acpHost.agents.get(agentId)
    if (!conn) throw new Error(`Agent ${agentId} 未运行`)

    const mcpServers = resolveMcpServersForAcp(conn, ourSessionId, context)
    const session = sessionStore.get(ourSessionId)
    const isPrimary = !!session?.is_primary
    const sessionMeta = isPrimary
      ? buildAgentSessionMeta(conn.runtime, conn.runtimeEnv, conn.agent, { isPrimary: true })
      : conn.sessionMeta

    const result = await conn.connection.newSession({
      cwd: context.cwd ?? process.cwd(),
      mcpServers,
      _meta: sessionMeta,
    })

    const acpSessionId = result.sessionId
    markSessionConnected(conn, ourSessionId, acpSessionId, context)

    updateInitialCapabilities(conn, ourSessionId, result)
    await applySessionRuntimePreferences(conn, ourSessionId)
    emitRuntimePreferencesApplied(conn, ourSessionId)
    log.debug(
      {
        agentId,
        ourSessionId,
        acpSessionId,
        currentModelId: result.models?.currentModelId,
        availableModels: result.models?.availableModels.map(m => ({ modelId: m.modelId, name: m.name })),
      },
      'ACP session 模型状态',
    )

    return acpSessionId
  },

  async resumeSession(
    agentId: string,
    ourSessionId: string,
    acpSessionId: string,
    context: AcpSessionContext = {},
  ): Promise<string> {
    const conn = acpHost.agents.get(agentId)
    if (!conn) throw new Error(`Agent ${agentId} 未运行`)
    const state = getRuntimeSession(conn, ourSessionId)
    if (conn.acpSessions.get(ourSessionId) === acpSessionId && state.contextKey === acpSessionContextKey(context)) return acpSessionId

    const session = sessionStore.get(ourSessionId)
    const isPrimary = !!session?.is_primary
    const sessionMeta = isPrimary
      ? buildAgentSessionMeta(conn.runtime, conn.runtimeEnv, conn.agent, { isPrimary: true })
      : conn.sessionMeta

    if (conn.agentCapabilities?.sessionCapabilities?.resume) {
      const mcpServers = resolveMcpServersForAcp(conn, ourSessionId, context)
      const result = await conn.connection.resumeSession({
        sessionId: acpSessionId,
        cwd: context.cwd ?? process.cwd(),
        mcpServers,
        _meta: sessionMeta,
      })
      markSessionConnected(conn, ourSessionId, acpSessionId, context)
      updateInitialCapabilities(conn, ourSessionId, result)
      await applySessionRuntimePreferences(conn, ourSessionId)
      emitRuntimePreferencesApplied(conn, ourSessionId)
      return acpSessionId
    }

    if (conn.agentCapabilities?.loadSession) {
      const result = await conn.connection.loadSession({
        sessionId: acpSessionId,
        cwd: context.cwd ?? process.cwd(),
        mcpServers: resolveMcpServersForAcp(conn, ourSessionId, context),
        _meta: sessionMeta,
      })
      markSessionConnected(conn, ourSessionId, acpSessionId, context)
      updateInitialCapabilities(conn, ourSessionId, result)
      await applySessionRuntimePreferences(conn, ourSessionId)
      emitRuntimePreferencesApplied(conn, ourSessionId)
      return acpSessionId
    }

    const newAcpSessionId = await acpHost.newSession(agentId, ourSessionId, context)
    if (newAcpSessionId !== acpSessionId) {
      log.warn(
        { agentId, ourSessionId, requestedAcpSessionId: acpSessionId, newAcpSessionId },
        'Agent 不支持恢复会话，已创建新的 ACP session',
      )
    }
    return newAcpSessionId
  },

  async prompt(agentId: string, ourSessionId: string, content: string, images?: ImageAttachment[], diagnostics: PromptDiagnosticsOptions = {}): Promise<void> {
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

    const startedAt = Date.now()
    beginTurn(conn, ourSessionId)
    startClientTurn(agentId, acpSessionId, diagnostics.turnId, diagnostics.messageId)
    log.info(
      { agentId, ourSessionId, acpSessionId, turnId: diagnostics.turnId, textLength: content.length, imageCount: images?.length ?? 0 },
      'ACP prompt start',
    )
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

      const wasCancelled = cancelledSessions.delete(ourSessionId)
      const stopReason = wasCancelled ? 'cancelled' : promptResult.stopReason

      log.info(
        { agentId, ourSessionId, acpSessionId, turnId: diagnostics.turnId, stopReason, totalTokens: turnUsage?.totalTokens, elapsedMs: Date.now() - startedAt },
        'Agent prompt completed',
      )
      events.emit('session:done', {
        sessionId: ourSessionId,
        agentId,
        messageId: diagnostics.messageId ?? `done-${ourSessionId}`,
        turnId: diagnostics.turnId,
        turnUsage,
        stopReason,
      })
      log.debug({ agentId, ourSessionId, acpSessionId, turnId: diagnostics.turnId, stopReason }, 'session done emitted from ACP prompt')
    } catch (err) {
      log.error({ err, agentId, ourSessionId, acpSessionId, turnId: diagnostics.turnId, elapsedMs: Date.now() - startedAt }, 'ACP prompt failed')
      throw err
    } finally {
      cancelledSessions.delete(ourSessionId)
      endClientTurn(agentId, acpSessionId)
      endTurn(conn, ourSessionId)
      log.debug(
        { agentId, ourSessionId, acpSessionId, turnId: diagnostics.turnId, elapsedMs: Date.now() - startedAt, activeTurnCount: conn.activeTurnCount },
        'ACP prompt cleanup complete',
      )
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

    const result =
      typeof value === 'boolean'
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

  async forkSession(
    agentId: string,
    sourceSessionId: string,
    targetSessionId: string,
    context: AcpSessionContext = {},
  ): Promise<string> {
    const conn = acpHost.agents.get(agentId)
    if (!conn) throw new Error(`Agent ${agentId} 未运行`)
    const sourceAcpSessionId = conn.acpSessions.get(sourceSessionId)
    if (!sourceAcpSessionId) throw new Error(`Session ${sourceSessionId} 没有对应的 ACP session`)
    return acpHost.forkSessionFromAcpSessionId(agentId, sourceAcpSessionId, targetSessionId, context)
  },

  async forkSessionFromAcpSessionId(
    agentId: string,
    sourceAcpSessionId: string,
    targetSessionId: string,
    context: AcpSessionContext = {},
  ): Promise<string> {
    let conn = acpHost.agents.get(agentId)
    if (!conn) {
      await acpHost.startAgent(agentId)
      conn = acpHost.agents.get(agentId)
    }
    if (!conn) throw new Error(`Agent ${agentId} 未运行`)
    if (!conn.agentCapabilities?.sessionCapabilities?.fork) throw new Error(`Agent ${agentId} 不支持 fork 会话`)

    const result = await conn.connection.unstable_forkSession({
      sessionId: sourceAcpSessionId,
      cwd: context.cwd ?? process.cwd(),
      mcpServers: resolveMcpServersForAcp(conn, targetSessionId, context),
      _meta: conn.sessionMeta,
    })
    markSessionConnected(conn, targetSessionId, result.sessionId, context)
    updateInitialCapabilities(conn, targetSessionId, result)
    await applySessionRuntimePreferences(conn, targetSessionId)
    emitRuntimePreferencesApplied(conn, targetSessionId)
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
        emitLifecycle(
          agentId,
          session.ourSessionId,
          'lifecycle.session_disconnected',
          '\u4f1a\u8bdd\u5df2\u56e0\u7a7a\u95f2\u65ad\u5f00\uff0c\u4e0b\u6b21\u53d1\u9001\u65f6\u4f1a\u81ea\u52a8\u6062\u590d',
        )
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

  resolvePermission,

  resolveElicitation,
}

async function startMockAgent(agentId: string, envFingerprint?: string): Promise<void> {
  const { resolve } = await import('path')
  const mockPath = resolve(import.meta.dirname, 'mock-agent.ts')
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'

  const { AgentProcess } = await import('./process.js')
  const mockProc = new AgentProcess(npxCmd, ['tsx', mockPath], {})
  await mockProc.start()

  const mockConnection = {
    get signal() {
      return new AbortController().signal
    },
    async initialize() {
      return { protocolVersion: 1 }
    },
    async newSession(params: { cwd: string }) {
      const result = await mockProc.sendRequest('session/create', { workingDirectory: params.cwd })
      return {
        sessionId: (result as { sessionId: string }).sessionId,
        models: { currentModelId: 'mock-fast', availableModels: MOCK_MODELS },
        modes: { currentModeId: 'default', availableModes: MOCK_MODES },
      }
    },
    async prompt(params: { sessionId: string; prompt: { type: string; text?: string }[] }) {
      const text = params.prompt.map((p) => p.text || '').join('\n')
      await mockProc.sendRequest('session/prompt', { sessionId: params.sessionId, content: text })
      return { stopReason: 'end_turn' }
    },
    async cancel(params: { sessionId: string }) {
      try {
        await mockProc.sendRequest('session/cancel', { sessionId: params.sessionId })
      } catch {
        /* ignore */
      }
    },
    async closeSession(params: { sessionId: string }) {
      try {
        await mockProc.sendRequest('session/close', { sessionId: params.sessionId })
      } catch {
        /* ignore */
      }
    },
    async unstable_setSessionModel(params: { modelId: string }) {
      if (!MOCK_MODELS.some((model) => model.modelId === params.modelId)) {
        throw new Error(`未知 Mock 模型: ${params.modelId}`)
      }
      return {}
    },
    async setSessionMode(params: { modeId: string }) {
      if (!MOCK_MODES.some((mode) => mode.id === params.modeId)) {
        throw new Error(`未知 Mock 模式: ${params.modeId}`)
      }
      return {}
    },
  } as unknown as acp.ClientSideConnection

  const proc = (mockProc as unknown as { proc: ChildProcess }).proc

  const agent = agentStore.get(agentId)
  const conn = createConnectionState(
    agentId,
    'mock',
    proc,
    mockConnection,
    undefined,
    envFingerprint,
    undefined,
    process.env,
    agent,
  )
  acpHost.agents.set(agentId, conn)

  mockProc.on('notification', (notification: { method: string; params?: Record<string, unknown> }) => {
    if (notification.method !== 'session/update') return
    const params = notification.params as Record<string, unknown>
    const acpSessionId = params.sessionId as string
    let ourSessionId: string | undefined
    for (const [ourId, acpId] of conn.acpSessions) {
      if (acpId === acpSessionId) {
        ourSessionId = ourId
        break
      }
    }
    if (!ourSessionId) return
    handleMockNotification(agentId, ourSessionId, params)
  })

  mockProc.on('exit', (code: number) => {
    conn.state = 'stopped'
    log.info({ agentId, code }, 'Mock Agent 进程退出')
    if (acpHost.agents.get(agentId) === conn) {
      agentStore.updateStatus(agentId, 'standby')
      events.emit('agent:status', { agentId, status: 'standby' })
      acpHost.agents.delete(agentId)
    }
  })

  agentStore.updateStatus(agentId, 'running')
  events.emit('agent:status', { agentId, status: 'running' })
  ensureIdleTimer()
  log.info({ agentId }, 'Mock Agent 初始化成功')
}

function handleMockNotification(agentId: string, ourSessionId: string, params: Record<string, unknown>) {
  const updateType = params.type as string
  const acpSessionId = typeof params.sessionId === 'string' ? params.sessionId : undefined
  const messageId = (acpSessionId ? getClientTurnMessageId(agentId, acpSessionId) : undefined)
    ?? (params.messageId as string)
    ?? `msg-${Date.now()}`
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
      return
    default:
      return
  }
  events.emit('session:update', { sessionId: ourSessionId, agentId, data })
}
