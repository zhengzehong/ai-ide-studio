import { mapConfigOptions, mergeCapabilitiesFromConfig } from '../../acp/capabilities.js'
import { cloneClaudeSessionFiles, hasClaudeSessionFiles } from '../../acp/claude-session-files.js'
import { resolveRuntimeModelPreference } from '../../acp/runtime-model-preference.js'
import type { RuntimeCancelResult, RuntimeStateSnapshot } from '../../ports/runtime-port.js'
import { createChildLogger } from '../../shared/logger.js'
import { AUTONOMOUS_TURN_NOTICE, createAutonomousTurnMessageId } from '../../shared/autonomous-turn.js'
import type { ImageAttachment, SessionCapabilities } from '../../types/ws-protocol.js'
import type { RuntimeSessionActorScheduler } from '../actors/session-actor.js'
import { ResourceGovernor } from '../resources/resource-governor.js'
import { createSdkAgentRuntime } from './sdk-agent-start.js'
import { handleSdkAgentExit, stopSdkAgentRuntime } from './sdk-agent-lifecycle.js'
import {
  startManagedAcpAgent,
  type ManagedAcpAgent,
  type StartManagedAcpAgentInput,
} from './managed-acp-agent.js'
import { runtimeAgentFingerprint, runtimeSessionContextFingerprint } from './runtime-fingerprints.js'
import { applySdkSessionPreferences, openSdkSession } from './sdk-session-runtime.js'
import { prepareSdkSessionFork } from './sdk-session-fork.js'
import { inspectSdkSessionRefresh } from './sdk-session-refresh.js'
import { sweepSdkRuntimeIdle } from './sdk-runtime-idle.js'
import type { RuntimeIdleThresholds } from './runtime-idle-sweep.js'
import { SdkRuntimeTurns, type RuntimeActiveTurn } from './runtime-active-turns.js'
import {
  AutonomousTurnTracker,
  type AutonomousStopReason,
} from './autonomous-turn-tracker.js'
import type { AcpAutonomousTurnBridge } from './acp-runtime-client.js'
import { publishSdkConfigSnapshot, publishSdkLifecycle, requireSdkAgent, requireSdkSession, touchSdkSession, updateSdkSessionConfigPreference } from './sdk-runtime-state.js'
import type {
  SdkAgentRuntime,
  SdkRuntimeHostDependencies,
  SdkRuntimeHostOptions,
  SdkSessionRuntime,
} from './sdk-runtime-types.js'

export type { SdkRuntimeHostDependencies, SdkRuntimeHostOptions } from './sdk-runtime-types.js'

const log = createChildLogger('sdk-runtime-host')

export class SdkRuntimeHost {
  private readonly agents = new Map<string, SdkAgentRuntime>()
  private readonly sessions = new Map<string, SdkSessionRuntime>()
  private readonly resources = new ResourceGovernor()
  private readonly startAgent: (input: StartManagedAcpAgentInput) => Promise<ManagedAcpAgent>
  private readonly materializeClaudeSession: typeof cloneClaudeSessionFiles
  private readonly findClaudeSessionFiles: typeof hasClaudeSessionFiles
  private readonly ensureBySession = new Map<string, Promise<string>>()
  private readonly startByAgent = new Map<string, Promise<SdkAgentRuntime>>()
  private readonly runtimeTurns: SdkRuntimeTurns
  private readonly autonomousTurns: AutonomousTurnTracker
  private readonly syntheticTurns = new Map<string, { messageId: string; agentId: string; turn: RuntimeActiveTurn }>()

  constructor(
    private readonly actors: RuntimeSessionActorScheduler,
    private readonly options: SdkRuntimeHostOptions,
    dependencies: SdkRuntimeHostDependencies = {},
  ) {
    this.startAgent = dependencies.startAgent ?? startManagedAcpAgent
    this.materializeClaudeSession = dependencies.cloneClaudeSessionFiles ?? cloneClaudeSessionFiles
    this.findClaudeSessionFiles = dependencies.hasClaudeSessionFiles ?? hasClaudeSessionFiles
    this.runtimeTurns = new SdkRuntimeTurns({
      actors: this.actors,
      agents: this.agents,
      sessions: this.sessions,
      host: this.options,
      timings: {
        cancelGraceMs: dependencies.cancelGraceMs ?? 800,
        closeGraceMs: dependencies.closeGraceMs ?? 1_000,
        restartGraceMs: dependencies.restartGraceMs ?? 1_000,
      },
      restartAgent: (agentId) => this.stopAgent(agentId),
    })
    this.autonomousTurns = new AutonomousTurnTracker({
      openTurn: (sessionId) => this.openAutonomousTurn(sessionId),
      settleTurn: (sessionId, input) => this.settleAutonomousTurn(sessionId, input),
      onFrameDropped: (sessionId, updateType, kind) => {
        log.debug({ sessionId, updateType, kind }, 'dropped unbound autonomous-lane frame')
      },
      ...(dependencies.autonomousTurnTimings ? { timings: dependencies.autonomousTurnTimings } : {}),
    })
  }

  private autonomousBridge(): AcpAutonomousTurnBridge {
    return {
      handleUnboundFrame: (sessionId, update) => this.autonomousTurns.handleUnboundFrame(sessionId, update),
      observeFrame: (sessionId, update) => this.autonomousTurns.observeFrame(sessionId, update),
      onRealTurnBegin: (sessionId) => this.autonomousTurns.onRealTurnBegin(sessionId),
      onRealTurnEnd: (sessionId) => this.autonomousTurns.onRealTurnEnd(sessionId),
    }
  }

  /**
   * 后台唤醒(自治回合)开场:合成 messageId(客户端绑定,不带 generation)+
   * session.active 清扫豁免 + turns 登记(可被 stop 中断)+ 来源注记 + activity running。
   */
  private openAutonomousTurn(sessionId: string): string | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    const agentId = session.snapshot.agent.id
    const agent = this.agents.get(agentId)
    if (!agent) return null
    const messageId = createAutonomousTurnMessageId()
    let turn: RuntimeActiveTurn
    try {
      turn = this.runtimeTurns.beginSyntheticTurn({
        sessionId,
        agentId,
        messageId,
        onCancelRequested: () => this.autonomousTurns.requestCancel(sessionId),
      })
    } catch (err) {
      // 已有在册回合(真回合刚结算的竞态窗口)→ 本帧没有合成归属,按幽灵丢弃。
      log.warn({ err, sessionId, messageId }, 'cannot open autonomous turn because another turn is registered')
      return null
    }
    session.active = true
    touchSdkSession(this.agents, session)
    this.syntheticTurns.set(sessionId, { messageId, agentId, turn })
    this.options.publishUpdate(agentId, {
      kind: 'session-update',
      sessionId,
      messageId,
      // wakeNotice:开场注记带旁路标记,核心聚合时不按正文处理——否则该文本会被
      // 随后的 tool_call 过程边界降级进 processNotes,而合成回合没有执行过程通道,降级即丢失(落库空行)。
      data: { messageId, role: 'agent', contentDelta: AUTONOMOUS_TURN_NOTICE, wakeNotice: true },
    })
    this.options.publishSessionActivity?.({ sessionId, agentId, state: 'running', reason: 'autonomous-wake' })
    return messageId
  }

  private settleAutonomousTurn(sessionId: string, input: {
    messageId: string
    stopReason: AutonomousStopReason
    error?: string
    reason: string
  }): void {
    const registered = this.syntheticTurns.get(sessionId)
    const agentId = registered?.messageId === input.messageId ? registered.agentId : this.sessions.get(sessionId)?.snapshot.agent.id
    if (registered?.messageId === input.messageId) {
      this.syntheticTurns.delete(sessionId)
      this.runtimeTurns.finishSyntheticTurn(registered.turn)
    }
    if (agentId) this.agents.get(agentId)?.router.endSyntheticTurn(sessionId, input.messageId)
    const session = this.sessions.get(sessionId)
    if (session) {
      // 按在册回合重算 active:真回合可能刚接管(合成结算后仍是 active),不能被误复位。
      session.active = this.runtimeTurns.hasActiveTurn(sessionId)
      touchSdkSession(this.agents, session)
    }
    if (!agentId) {
      log.warn({ sessionId, messageId: input.messageId, reason: input.reason }, 'autonomous turn settled after runtime teardown')
      return
    }
    log.info(
      { sessionId, messageId: input.messageId, stopReason: input.stopReason, reason: input.reason, agentId },
      'autonomous turn terminal',
    )
    void this.options.publishDone({
      sessionId,
      agentId,
      messageId: input.messageId,
      stopReason: input.stopReason,
      ...(input.error !== undefined ? { error: input.error } : {}),
    }).catch((err: unknown) => {
      log.warn({ err, sessionId, messageId: input.messageId }, 'autonomous turn done publish failed')
    })
    this.options.publishSessionActivity?.({
      sessionId,
      agentId,
      state: 'idle',
      reason: input.stopReason === 'cancelled'
        ? 'autonomous-cancelled'
        : input.stopReason === 'error' ? 'autonomous-error' : 'autonomous-done',
    })
  }

  private disposeAutonomousTurnsForAgent(agentId: string, input: { stopReason: AutonomousStopReason; error?: string }): void {
    for (const [sessionId, registered] of [...this.syntheticTurns]) {
      if (registered.agentId === agentId) this.autonomousTurns.disposeSession(sessionId, input)
    }
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  get sessionCount(): number {
    return this.sessions.size
  }

  get agentCount(): number {
    return this.agents.size
  }

  async ensureSession(
    snapshot: RuntimeStateSnapshot,
    options: { emitLifecycle?: boolean } = {},
  ): Promise<string> {
    const pending = this.ensureBySession.get(snapshot.session.id)
    if (pending) return pending
    const emitLifecycle = options.emitLifecycle !== false
    const ensuring = this.ensureSessionInternal(snapshot, emitLifecycle).catch((error: unknown) => {
      if (emitLifecycle) {
        publishSdkLifecycle(this.options.publishUpdate, snapshot, 'lifecycle.failed', `连接失败：${errorMessage(error)}`)
      }
      throw error
    }).finally(() => {
      if (this.ensureBySession.get(snapshot.session.id) === ensuring) {
        this.ensureBySession.delete(snapshot.session.id)
      }
    })
    this.ensureBySession.set(snapshot.session.id, ensuring)
    return ensuring
  }

  private async ensureSessionInternal(snapshot: RuntimeStateSnapshot, emitLifecycle: boolean): Promise<string> {
    const existing = this.sessions.get(snapshot.session.id)
    const contextFingerprint = runtimeSessionContextFingerprint(snapshot)
    const refresh = inspectSdkSessionRefresh({ agents: this.agents, contextFingerprint, existing, snapshot })
    if (refresh.deferredAcpSessionId) return refresh.deferredAcpSessionId
    const { profileChanged } = refresh
    const agentWasRunning = this.agents.has(snapshot.agent.id)
    if (!agentWasRunning && emitLifecycle) {
      publishSdkLifecycle(this.options.publishUpdate, snapshot, 'lifecycle.runtime_starting', '正在启动 Agent...')
    }
    const agent = await this.ensureAgent(snapshot)
    if (!agentWasRunning && emitLifecycle) {
      publishSdkLifecycle(this.options.publishUpdate, snapshot, 'lifecycle.runtime_ready', 'Agent 已就绪')
    }
    // ensureAgent may replace the ACP process and remove all old Session bindings.
    // Re-read the map so a pre-restart `existing` object can never be reused.
    const current = this.sessions.get(snapshot.session.id)
    if (current?.contextFingerprint === contextFingerprint) {
      current.snapshot = snapshot
      touchSdkSession(this.agents, current)
      if (profileChanged) {
        agent.router.bindSession(
          snapshot.session.id,
          current.acpSessionId,
          snapshot.autoApprovedToolNames,
          current.capabilities.currentModeId,
          snapshot.runtime.appliedModelProfile?.contextWindow,
        )
        const modelId = resolveRuntimeModelPreference({
          runtime: snapshot.agent.runtime,
          profile: snapshot.runtime.appliedModelProfile,
          capabilities: current.capabilities,
          sessionModelId: snapshot.runtimePreferences.modelId,
        })
        if (modelId && modelId !== current.capabilities.currentModelId) {
          await this.setModel(snapshot.agent.id, snapshot.session.id, modelId)
        }
      }
      return current.acpSessionId
    }
    const acpSessionIdToResume = snapshot.session.acpSessionId ?? current?.acpSessionId ?? null
    if (current) {
      agent.router.unbindSession(snapshot.session.id)
      this.sessions.delete(snapshot.session.id)
    }
    const opened = await openSdkSession({
      connection: agent.connection,
      snapshot,
      agentCapabilities: agent.agentCapabilities,
      acpSessionIdToResume,
      lifecycle: emitLifecycle
        ? (eventType, content) => publishSdkLifecycle(this.options.publishUpdate, snapshot, eventType, content)
        : undefined,
    })
    const session: SdkSessionRuntime = {
      snapshot,
      acpSessionId: opened.acpSessionId,
      capabilities: opened.capabilities,
      active: false,
      contextFingerprint,
      lastUsedAt: Date.now(),
    }
    this.sessions.set(snapshot.session.id, session)
    agent.router.bindSession(snapshot.session.id, opened.acpSessionId, snapshot.autoApprovedToolNames,
      opened.capabilities.currentModeId, snapshot.runtime.appliedModelProfile?.contextWindow)
    await applySdkSessionPreferences({
      snapshot,
      capabilities: session.capabilities,
      setModel: (modelId) => this.setModel(snapshot.agent.id, snapshot.session.id, modelId),
      setMode: (modeId) => this.setMode(snapshot.agent.id, snapshot.session.id, modeId),
      setConfig: (configId, value) => this.setConfig(snapshot.agent.id, snapshot.session.id, configId, value),
    })
    if (emitLifecycle) publishSdkLifecycle(this.options.publishUpdate, snapshot, 'lifecycle.session_ready', '会话已连接')
    return opened.acpSessionId
  }

  async prompt(input: {
    agentId: string
    sessionId: string
    content: string
    images?: ImageAttachment[]
    diagnostics?: { turnId?: string; messageId?: string }
  }): Promise<void> {
    const replacement = this.startByAgent.get(input.agentId)
    if (replacement) await replacement
    // 真回合即将开始:先收敛同会话的合成回合。RuntimeActiveTurns 每会话只允许一个在册回合,
    // 不先结算会导致真 prompt 的 begin() 抛 "Runtime turn already active"。
    // 合成回合按 end_turn 正常收尾(内容落库),真回合随后接管绑定。
    this.autonomousTurns.disposeSession(input.sessionId, { stopReason: 'end_turn' })
    return this.runtimeTurns.prompt(input)
  }

  cancelPrompt(agentId: string, sessionId: string): Promise<RuntimeCancelResult> {
    return this.runtimeTurns.cancel(agentId, sessionId)
  }

  async closeSession(agentId: string, sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || session.snapshot.agent.id !== agentId) return
    this.autonomousTurns.disposeSession(sessionId, { stopReason: 'cancelled' })
    const agent = this.agents.get(agentId)
    if (!agent) {
      this.sessions.delete(sessionId)
      return
    }
    agent.router.cancelSession(sessionId)
    await agent.connection.closeSession({ sessionId: session.acpSessionId }).catch(() => undefined)
    agent.router.unbindSession(sessionId)
    this.sessions.delete(sessionId)
    if (this.actors.pendingCount(sessionId) === 0) this.actors.resetSession(sessionId)
  }

  async forkSession(snapshot: RuntimeStateSnapshot, sourceAcpSessionId: string): Promise<string> {
    const agent = await this.ensureAgent(snapshot)
    const opened = await prepareSdkSessionFork({
      connection: agent.connection,
      agentCapabilities: agent.agentCapabilities,
      snapshot,
      sourceAcpSessionId,
      materializeClaudeSession: this.materializeClaudeSession,
      findClaudeSessionFiles: this.findClaudeSessionFiles,
    })
    const session: SdkSessionRuntime = {
      snapshot,
      acpSessionId: opened.acpSessionId,
      capabilities: opened.capabilities,
      active: false,
      contextFingerprint: runtimeSessionContextFingerprint(snapshot),
      lastUsedAt: Date.now(),
    }
    this.sessions.set(snapshot.session.id, session)
    agent.router.bindSession(snapshot.session.id, opened.acpSessionId, snapshot.autoApprovedToolNames,
      session.capabilities.currentModeId, snapshot.runtime.appliedModelProfile?.contextWindow)
    await applySdkSessionPreferences({
      snapshot,
      capabilities: session.capabilities,
      setModel: (modelId) => this.setModel(snapshot.agent.id, snapshot.session.id, modelId),
      setMode: (modeId) => this.setMode(snapshot.agent.id, snapshot.session.id, modeId),
      setConfig: (configId, value) => this.setConfig(snapshot.agent.id, snapshot.session.id, configId, value),
    })
    return opened.acpSessionId
  }

  async setModel(agentId: string, sessionId: string, modelId: string): Promise<void> {
    const session = requireSdkSession(this.sessions, sessionId, agentId)
    const connection = requireSdkAgent(this.agents, agentId).connection
    try {
      await connection.unstable_setSessionModel({ sessionId: session.acpSessionId, modelId })
    } catch {
      await connection.setSessionConfigOption({ sessionId: session.acpSessionId, configId: 'model', value: modelId })
    }
    session.capabilities.currentModelId = modelId
    touchSdkSession(this.agents, session)
    this.options.publishCapabilities?.(session.snapshot.session.id, session.capabilities)
  }

  async setMode(agentId: string, sessionId: string, modeId: string): Promise<void> {
    const session = requireSdkSession(this.sessions, sessionId, agentId)
    await requireSdkAgent(this.agents, agentId).connection.setSessionMode({ sessionId: session.acpSessionId, modeId })
    session.capabilities.currentModeId = modeId
    requireSdkAgent(this.agents, agentId).router.setPermissionMode(sessionId, modeId)
    touchSdkSession(this.agents, session)
    this.options.publishCapabilities?.(session.snapshot.session.id, session.capabilities)
  }

  async setConfig(agentId: string, sessionId: string, configId: string, value: string | boolean): Promise<void> {
    const session = requireSdkSession(this.sessions, sessionId, agentId)
    const result = await requireSdkAgent(this.agents, agentId).connection.setSessionConfigOption({
      sessionId: session.acpSessionId,
      configId,
      ...(typeof value === 'boolean' ? { type: 'boolean' as const, value } : { value }),
    })
    session.capabilities = mergeCapabilitiesFromConfig(session.capabilities, mapConfigOptions(result.configOptions))
    updateSdkSessionConfigPreference(session, configId, value)
    if (session.capabilities.currentModeId)
      requireSdkAgent(this.agents, agentId).router.setPermissionMode(sessionId, session.capabilities.currentModeId)
    touchSdkSession(this.agents, session)
    this.options.publishCapabilities?.(session.snapshot.session.id, session.capabilities)
    publishSdkConfigSnapshot(this.options.publishUpdate, session.snapshot, session.capabilities)
  }

  getSessionCapabilities(agentId: string, sessionId: string): SessionCapabilities | undefined {
    return requireSdkSession(this.sessions, sessionId, agentId).capabilities
  }

  resolvePermission(sessionId: string, requestId: string, optionId?: string, cancelled?: boolean): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    touchSdkSession(this.agents, session)
    return requireSdkAgent(this.agents, session.snapshot.agent.id).router.resolvePermission(sessionId, requestId, optionId, cancelled)
  }

  resolveElicitation(
    sessionId: string,
    requestId: string,
    action: 'accept' | 'decline' | 'cancel',
    content?: Record<string, string | number | boolean | string[]>,
  ): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    touchSdkSession(this.agents, session)
    return requireSdkAgent(this.agents, session.snapshot.agent.id).router.resolveElicitation(sessionId, requestId, action, content)
  }

  sweepIdle(now: number, thresholds: RuntimeIdleThresholds): Promise<void> {
    return sweepSdkRuntimeIdle({
      now,
      ...thresholds,
      sessions: this.sessions,
      agents: this.agents,
      actors: this.actors,
      closeSession: (agentId, sessionId) => this.closeSession(agentId, sessionId),
      stopAgent: (agentId) => this.stopAgent(agentId),
      onSessionDisconnected: (snapshot) => publishSdkLifecycle(
        this.options.publishUpdate,
        snapshot,
        'lifecycle.session_disconnected',
        '\u4f1a\u8bdd\u5df2\u56e0\u7a7a\u95f2\u65ad\u5f00\uff0c\u4e0b\u6b21\u53d1\u9001\u65f6\u4f1a\u81ea\u52a8\u6062\u590d',
      ),
    })
  }

  async close(): Promise<void> {
    for (const agentId of [...this.agents.keys()]) await this.stopAgent(agentId)
    this.sessions.clear()
    this.resources.close()
  }

  private async ensureAgent(snapshot: RuntimeStateSnapshot): Promise<SdkAgentRuntime> {
    const fingerprint = runtimeAgentFingerprint(snapshot)
    const existing = this.agents.get(snapshot.agent.id)
    if (existing?.fingerprint === fingerprint) {
      existing.lastUsedAt = Date.now()
      return existing
    }
    const pending = this.startByAgent.get(snapshot.agent.id)
    if (pending) {
      await pending
      return this.ensureAgent(snapshot)
    }
    const starting = this.startAgentInternal(snapshot, fingerprint).finally(() => {
      if (this.startByAgent.get(snapshot.agent.id) === starting) this.startByAgent.delete(snapshot.agent.id)
    })
    this.startByAgent.set(snapshot.agent.id, starting)
    return starting
  }

  private async startAgentInternal(
    snapshot: RuntimeStateSnapshot,
    fingerprint: string,
  ): Promise<SdkAgentRuntime> {
    const existing = this.agents.get(snapshot.agent.id)
    if (existing?.fingerprint === fingerprint) return existing
    if (existing) {
      // 换运行时(模型/连接指纹变化)会替换整条 CLI 进程:合成回合随重启收敛(cancelled),
      // 避免 waitForAgentIdle 被长时间后台执行阻塞,也避免重启后残留调度。
      this.disposeAutonomousTurnsForAgent(snapshot.agent.id, { stopReason: 'cancelled' })
      await this.runtimeTurns.waitForAgentIdle(snapshot.agent.id)
      if (this.agents.get(snapshot.agent.id) === existing) await this.stopAgent(snapshot.agent.id)
    }
    const runtime = await createSdkAgentRuntime({
      snapshot,
      fingerprint,
      resources: this.resources,
      sessions: this.sessions,
      options: this.options,
      autonomousTurns: this.autonomousBridge(),
      startAgent: this.startAgent,
      acceptTurnUpdate: (sessionId, streamGeneration) => this.runtimeTurns.acceptsUpdate(sessionId, streamGeneration),
    })
    this.agents.set(snapshot.agent.id, runtime)
    this.options.publishAgentStatus?.({ agentId: snapshot.agent.id, status: 'running', captureBindingId: runtime.captureBindingId })
    const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
      // 退出前先收敛在册的自治回合:发合成 done(停止 UI"正在执行"、落库),并清定时器防泄漏豁免。
      this.disposeAutonomousTurnsForAgent(snapshot.agent.id, {
        stopReason: 'error',
        error: `Agent runtime exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
      })
      return handleSdkAgentExit({
        agentId: snapshot.agent.id, runtime, agents: this.agents, sessions: this.sessions,
        actors: this.actors, options: this.options, code, signal,
      })
    }
    runtime.process.once('exit', handleExit)
    if (typeof runtime.process.exitCode === 'number' || runtime.process.signalCode) {
      handleExit(runtime.process.exitCode, runtime.process.signalCode)
    }
    return runtime
  }

  private async stopAgent(agentId: string): Promise<void> {
    this.disposeAutonomousTurnsForAgent(agentId, { stopReason: 'cancelled' })
    stopSdkAgentRuntime({ agentId, agents: this.agents, sessions: this.sessions, actors: this.actors, options: this.options })
  }

}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
