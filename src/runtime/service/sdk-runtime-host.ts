import { mapConfigOptions, mergeCapabilitiesFromConfig } from '../../acp/capabilities.js'
import { resolveDesiredRuntimeMode } from '../../acp/runtime-mode-preference.js'
import type { RuntimeCancelResult, RuntimeStateSnapshot } from '../../ports/runtime-port.js'
import { createChildLogger } from '../../shared/logger.js'
import type { ImageAttachment, SessionCapabilities } from '../../types/ws-protocol.js'
import type { RuntimeSessionActorScheduler } from '../actors/session-actor.js'
import { ResourceGovernor } from '../resources/resource-governor.js'
import { createAcpRuntimeClient } from './acp-runtime-client.js'
import {
  startManagedAcpAgent,
  type ManagedAcpAgent,
  type StartManagedAcpAgentInput,
} from './managed-acp-agent.js'
import { runtimeAgentFingerprint, runtimeSessionContextFingerprint } from './runtime-fingerprints.js'
import { applySdkSessionPreferences, initialCapabilities, openSdkSession } from './sdk-session-runtime.js'
import { sweepSdkRuntimeIdle } from './sdk-runtime-idle.js'
import type { RuntimeIdleThresholds } from './runtime-idle-sweep.js'
import { SdkRuntimeTurns } from './runtime-active-turns.js'
import { publishSdkLifecycle, requireSdkAgent, requireSdkSession, touchSdkSession } from './sdk-runtime-state.js'
import type {
  SdkAgentRuntime,
  SdkRuntimeHostDependencies,
  SdkRuntimeHostOptions,
  SdkSessionRuntime,
} from './sdk-runtime-types.js'

const log = createChildLogger('sdk-runtime-host')

export type { SdkRuntimeHostDependencies, SdkRuntimeHostOptions } from './sdk-runtime-types.js'

export class SdkRuntimeHost {
  private readonly agents = new Map<string, SdkAgentRuntime>()
  private readonly sessions = new Map<string, SdkSessionRuntime>()
  private readonly resources = new ResourceGovernor()
  private readonly startAgent: (input: StartManagedAcpAgentInput) => Promise<ManagedAcpAgent>
  private readonly ensureBySession = new Map<string, Promise<string>>()
  private readonly startByAgent = new Map<string, Promise<SdkAgentRuntime>>()
  private readonly runtimeTurns: SdkRuntimeTurns

  constructor(
    private readonly actors: RuntimeSessionActorScheduler,
    private readonly options: SdkRuntimeHostOptions,
    dependencies: SdkRuntimeHostDependencies = {},
  ) {
    this.startAgent = dependencies.startAgent ?? startManagedAcpAgent
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
    const agentWasRunning = this.agents.has(snapshot.agent.id)
    if (!agentWasRunning && emitLifecycle) {
      publishSdkLifecycle(this.options.publishUpdate, snapshot, 'lifecycle.runtime_starting', '正在启动 Agent...')
    }
    const agent = await this.ensureAgent(snapshot)
    if (!agentWasRunning && emitLifecycle) {
      publishSdkLifecycle(this.options.publishUpdate, snapshot, 'lifecycle.runtime_ready', 'Agent 已就绪')
    }
    const existing = this.sessions.get(snapshot.session.id)
    const contextFingerprint = runtimeSessionContextFingerprint(snapshot)
    if (existing?.contextFingerprint === contextFingerprint) {
      existing.snapshot = snapshot
      touchSdkSession(this.agents, existing)
      return existing.acpSessionId
    }
    const acpSessionIdToResume = snapshot.session.acpSessionId ?? existing?.acpSessionId ?? null
    if (existing) {
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
      resolveDesiredRuntimeMode(snapshot.agent.runtime, snapshot.runtimePreferences.modeId))
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

  prompt(input: {
    agentId: string
    sessionId: string
    content: string
    images?: ImageAttachment[]
    diagnostics?: { turnId?: string; messageId?: string }
  }): Promise<void> {
    return this.runtimeTurns.prompt(input)
  }

  cancelPrompt(agentId: string, sessionId: string): Promise<RuntimeCancelResult> {
    return this.runtimeTurns.cancel(agentId, sessionId)
  }

  async closeSession(agentId: string, sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || session.snapshot.agent.id !== agentId) return
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
    if (!agent.agentCapabilities?.sessionCapabilities?.fork)
      throw new Error(`Agent ${snapshot.agent.id} does not support fork`)
    const result = await agent.connection.unstable_forkSession({
      sessionId: sourceAcpSessionId,
      cwd: snapshot.session.cwd,
      mcpServers: snapshot.mcpServers,
      _meta: snapshot.runtime.sessionMeta,
    })
    const session: SdkSessionRuntime = {
      snapshot,
      acpSessionId: result.sessionId,
      capabilities: initialCapabilities(result, agent.agentCapabilities),
      active: false,
      contextFingerprint: runtimeSessionContextFingerprint(snapshot),
      lastUsedAt: Date.now(),
    }
    this.sessions.set(snapshot.session.id, session)
    agent.router.bindSession(snapshot.session.id, result.sessionId, snapshot.autoApprovedToolNames,
      resolveDesiredRuntimeMode(snapshot.agent.runtime, snapshot.runtimePreferences.modeId))
    await applySdkSessionPreferences({
      snapshot,
      capabilities: session.capabilities,
      setModel: (modelId) => this.setModel(snapshot.agent.id, snapshot.session.id, modelId),
      setMode: (modeId) => this.setMode(snapshot.agent.id, snapshot.session.id, modeId),
      setConfig: (configId, value) => this.setConfig(snapshot.agent.id, snapshot.session.id, configId, value),
    })
    return result.sessionId
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
    if (configId === 'mode' && typeof value === 'string')
      requireSdkAgent(this.agents, agentId).router.setPermissionMode(sessionId, value)
    touchSdkSession(this.agents, session)
    this.options.publishCapabilities?.(session.snapshot.session.id, session.capabilities)
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
    if (pending) return pending
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
    if (existing) await this.stopAgent(snapshot.agent.id)
    const router = createAcpRuntimeClient({
      agentId: snapshot.agent.id,
      resources: this.resources,
      publishUpdate: (update) => this.options.publishUpdate(snapshot.agent.id, update),
      updateCapabilities: (sessionId, update) => {
        const session = this.sessions.get(sessionId)
        if (session) session.capabilities = update(session.capabilities)
      },
      publishCapabilities: (sessionId, capabilities) => this.options.publishCapabilities?.(sessionId, capabilities),
      acceptTurnUpdate: (sessionId, streamGeneration) => this.runtimeTurns.acceptsUpdate(sessionId, streamGeneration),
    })
    const command = snapshot.runtime.command
    if (!command) {
      router.close()
      throw new Error(`Runtime command is missing for ${snapshot.agent.runtime}`)
    }
    const managed = await this.startAgent({
      agentId: snapshot.agent.id,
      runtime: snapshot.agent.runtime,
      command,
      env: snapshot.runtime.env,
      router,
    })
    let rejectExit: ((error: Error) => void) | undefined
    const exitPromise = new Promise<never>((_resolve, reject) => { rejectExit = reject })
    void exitPromise.catch(() => undefined)
    const runtime: SdkAgentRuntime = {
      fingerprint,
      process: managed.process,
      connection: managed.connection,
      router,
      agentCapabilities: managed.agentCapabilities,
      exitPromise,
      rejectExit: rejectExit!,
      stopping: false,
      lastUsedAt: Date.now(),
    }
    this.agents.set(snapshot.agent.id, runtime)
    this.options.publishAgentStatus?.({ agentId: snapshot.agent.id, status: 'running' })
    managed.process.once('exit', (code, signal) => {
      this.handleAgentExit(snapshot.agent.id, runtime, code, signal)
    })
    if (typeof managed.process.exitCode === 'number' || managed.process.signalCode) {
      this.handleAgentExit(snapshot.agent.id, runtime, managed.process.exitCode, managed.process.signalCode)
    }
    return runtime
  }

  private async stopAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent) return
    agent.stopping = true
    agent.rejectExit(new Error(`Agent runtime stopped: ${agentId}`))
    this.removeAgentSessions(agentId, agent)
    agent.router.close()
    this.agents.delete(agentId)
    this.options.publishAgentStatus?.({ agentId, status: 'standby' })
    if (!agent.process.killed) agent.process.kill()
  }

  private handleAgentExit(
    agentId: string,
    runtime: SdkAgentRuntime,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.agents.get(agentId) !== runtime) return
    this.agents.delete(agentId)
    this.removeAgentSessions(agentId, runtime)
    runtime.router.close()
    runtime.rejectExit(new Error(`Agent runtime exited: ${agentId} (code=${code ?? 'null'}, signal=${signal ?? 'null'})`))
    this.options.publishAgentStatus?.({ agentId, status: 'standby' })
    if (!runtime.stopping) log.warn({ agentId, code, signal }, 'Agent runtime exited unexpectedly')
  }

  private removeAgentSessions(agentId: string, runtime: SdkAgentRuntime): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.snapshot.agent.id !== agentId) continue
      runtime.router.cancelSession(sessionId)
      runtime.router.unbindSession(sessionId)
      this.sessions.delete(sessionId)
      if (this.actors.pendingCount(sessionId) === 0) this.actors.resetSession(sessionId)
    }
  }

}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
