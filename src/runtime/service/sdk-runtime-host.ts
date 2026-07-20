import type { ChildProcess } from 'node:child_process'
import * as acp from '@agentclientprotocol/sdk'
import { mapConfigOptions, mergeCapabilitiesFromConfig } from '../../acp/capabilities.js'
import { resolveDesiredRuntimeMode } from '../../acp/runtime-mode-preference.js'
import type { RuntimeStateSnapshot } from '../../ports/runtime-port.js'
import { createChildLogger } from '../../shared/logger.js'
import type { ImageAttachment, SessionCapabilities, TurnUsageData } from '../../types/ws-protocol.js'
import type { RuntimeSessionActorScheduler } from '../actors/session-actor.js'
import { ResourceGovernor } from '../resources/resource-governor.js'
import type { RuntimeCoalescibleUpdate } from '../streams/runtime-update-coalescer.js'
import { createAcpRuntimeClient, type AcpRuntimeClientRouter } from './acp-runtime-client.js'
import {
  startManagedAcpAgent,
  type ManagedAcpAgent,
  type StartManagedAcpAgentInput,
} from './managed-acp-agent.js'

const log = createChildLogger('sdk-runtime-host')

interface SdkAgentRuntime {
  fingerprint: string
  process: ChildProcess
  connection: acp.ClientSideConnection
  router: AcpRuntimeClientRouter
  agentCapabilities?: acp.AgentCapabilities
  exitPromise: Promise<never>
  rejectExit: (error: Error) => void
  stopping: boolean
}

interface SdkSessionRuntime {
  snapshot: RuntimeStateSnapshot
  acpSessionId: string
  capabilities: SessionCapabilities
  active: boolean
}

export interface SdkRuntimeHostOptions {
  publishUpdate: (agentId: string, update: RuntimeCoalescibleUpdate) => void
  publishDone: (input: {
    sessionId: string
    agentId: string
    messageId: string
    turnId?: string
    stopReason: string
    turnUsage?: TurnUsageData
  }) => Promise<void>
}

export interface SdkRuntimeHostDependencies {
  startAgent?: (input: StartManagedAcpAgentInput) => Promise<ManagedAcpAgent>
}

export class SdkRuntimeHost {
  private readonly agents = new Map<string, SdkAgentRuntime>()
  private readonly sessions = new Map<string, SdkSessionRuntime>()
  private readonly resources = new ResourceGovernor()
  private readonly startAgent: (input: StartManagedAcpAgentInput) => Promise<ManagedAcpAgent>

  constructor(
    private readonly actors: RuntimeSessionActorScheduler,
    private readonly options: SdkRuntimeHostOptions,
    dependencies: SdkRuntimeHostDependencies = {},
  ) {
    this.startAgent = dependencies.startAgent ?? startManagedAcpAgent
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  get sessionCount(): number {
    return this.sessions.size
  }

  async ensureSession(snapshot: RuntimeStateSnapshot): Promise<string> {
    const existing = this.sessions.get(snapshot.session.id)
    if (existing) {
      existing.snapshot = snapshot
      return existing.acpSessionId
    }
    const agent = await this.ensureAgent(snapshot)
    const params = {
      cwd: snapshot.session.cwd,
      mcpServers: snapshot.mcpServers,
      _meta: snapshot.runtime.sessionMeta,
    }
    let acpSessionId: string
    let initial: {
      models?: acp.SessionModelState | null
      modes?: acp.SessionModeState | null
      configOptions?: acp.SessionConfigOption[] | null
    }
    if (snapshot.session.acpSessionId && agent.agentCapabilities?.sessionCapabilities?.resume) {
      initial = await agent.connection.resumeSession({ sessionId: snapshot.session.acpSessionId, ...params })
      acpSessionId = snapshot.session.acpSessionId
    } else if (snapshot.session.acpSessionId && agent.agentCapabilities?.loadSession) {
      initial = await agent.connection.loadSession({ sessionId: snapshot.session.acpSessionId, ...params })
      acpSessionId = snapshot.session.acpSessionId
    } else {
      const created = await agent.connection.newSession(params)
      initial = created
      acpSessionId = created.sessionId
    }
    const session: SdkSessionRuntime = {
      snapshot,
      acpSessionId,
      capabilities: initialCapabilities(initial, agent.agentCapabilities),
      active: false,
    }
    this.sessions.set(snapshot.session.id, session)
    agent.router.bindSession(snapshot.session.id, acpSessionId, snapshot.autoApprovedToolNames)
    await this.applyPreferences(agent.connection, session)
    return acpSessionId
  }

  prompt(input: {
    agentId: string
    sessionId: string
    content: string
    images?: ImageAttachment[]
    diagnostics?: { turnId?: string; messageId?: string }
  }): Promise<void> {
    return this.actors.enqueue(
      input.sessionId,
      async () => {
        const session = this.requireSession(input.sessionId, input.agentId)
        const agent = this.requireAgent(input.agentId)
        const messageId = input.diagnostics?.messageId ?? `message-${Date.now()}`
        const blocks: acp.ContentBlock[] = [{ type: 'text', text: input.content }]
        for (const image of input.images ?? []) {
          blocks.push({ type: 'image', data: image.data, mimeType: image.mimeType })
        }
        session.active = true
        agent.router.beginTurn(input.sessionId, messageId, input.diagnostics?.turnId)
        try {
          const result = await Promise.race([
            agent.connection.prompt({ sessionId: session.acpSessionId, prompt: blocks }),
            agent.exitPromise,
          ])
          await this.options.publishDone({
            sessionId: input.sessionId,
            agentId: input.agentId,
            messageId,
            turnId: input.diagnostics?.turnId,
            stopReason: result.stopReason,
            turnUsage: result.usage
              ? {
                  inputTokens: result.usage.inputTokens,
                  outputTokens: result.usage.outputTokens,
                  totalTokens: result.usage.totalTokens,
                  cachedReadTokens: result.usage.cachedReadTokens ?? undefined,
                  thoughtTokens: result.usage.thoughtTokens ?? undefined,
                }
              : undefined,
          })
        } finally {
          session.active = false
          agent.router.endTurn(input.sessionId)
        }
      },
      { payloadBytes: Buffer.byteLength(input.content, 'utf8') },
    )
  }

  async cancelPrompt(agentId: string, sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || session.snapshot.agent.id !== agentId) return
    const agent = this.agents.get(agentId)
    if (!agent) return
    agent.router.cancelSession(sessionId)
    await agent.connection.cancel({ sessionId: session.acpSessionId })
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
    }
    this.sessions.set(snapshot.session.id, session)
    agent.router.bindSession(snapshot.session.id, result.sessionId, snapshot.autoApprovedToolNames)
    await this.applyPreferences(agent.connection, session)
    return result.sessionId
  }

  async setModel(agentId: string, sessionId: string, modelId: string): Promise<void> {
    const session = this.requireSession(sessionId, agentId)
    const connection = this.requireAgent(agentId).connection
    try {
      await connection.unstable_setSessionModel({ sessionId: session.acpSessionId, modelId })
    } catch {
      await connection.setSessionConfigOption({ sessionId: session.acpSessionId, configId: 'model', value: modelId })
    }
    session.capabilities.currentModelId = modelId
  }

  async setMode(agentId: string, sessionId: string, modeId: string): Promise<void> {
    const session = this.requireSession(sessionId, agentId)
    await this.requireAgent(agentId).connection.setSessionMode({ sessionId: session.acpSessionId, modeId })
    session.capabilities.currentModeId = modeId
  }

  async setConfig(agentId: string, sessionId: string, configId: string, value: string | boolean): Promise<void> {
    const session = this.requireSession(sessionId, agentId)
    const result = await this.requireAgent(agentId).connection.setSessionConfigOption({
      sessionId: session.acpSessionId,
      configId,
      ...(typeof value === 'boolean' ? { type: 'boolean' as const, value } : { value }),
    })
    session.capabilities = mergeCapabilitiesFromConfig(session.capabilities, mapConfigOptions(result.configOptions))
  }

  getSessionCapabilities(agentId: string, sessionId: string): SessionCapabilities | undefined {
    return this.requireSession(sessionId, agentId).capabilities
  }

  resolvePermission(sessionId: string, requestId: string, optionId?: string, cancelled?: boolean): boolean {
    const session = this.sessions.get(sessionId)
    return session
      ? this.requireAgent(session.snapshot.agent.id).router.resolvePermission(sessionId, requestId, optionId, cancelled)
      : false
  }

  resolveElicitation(
    sessionId: string,
    requestId: string,
    action: 'accept' | 'decline' | 'cancel',
    content?: Record<string, string | number | boolean | string[]>,
  ): boolean {
    const session = this.sessions.get(sessionId)
    return session
      ? this.requireAgent(session.snapshot.agent.id).router.resolveElicitation(sessionId, requestId, action, content)
      : false
  }

  async close(): Promise<void> {
    for (const agentId of [...this.agents.keys()]) await this.stopAgent(agentId)
    this.sessions.clear()
    this.resources.close()
  }

  private async ensureAgent(snapshot: RuntimeStateSnapshot): Promise<SdkAgentRuntime> {
    const fingerprint = JSON.stringify([snapshot.agent.runtime, snapshot.runtime.command, snapshot.runtime.env])
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
    }
    this.agents.set(snapshot.agent.id, runtime)
    managed.process.once('exit', (code, signal) => {
      this.handleAgentExit(snapshot.agent.id, runtime, code, signal)
    })
    if (typeof managed.process.exitCode === 'number' || managed.process.signalCode) {
      this.handleAgentExit(snapshot.agent.id, runtime, managed.process.exitCode, managed.process.signalCode)
    }
    return runtime
  }

  private async applyPreferences(connection: acp.ClientSideConnection, session: SdkSessionRuntime): Promise<void> {
    const preferences = session.snapshot.runtimePreferences
    if (preferences.modelId)
      await this.setModel(session.snapshot.agent.id, session.snapshot.session.id, preferences.modelId)
    const modeId = resolveDesiredRuntimeMode(session.snapshot.agent.runtime, preferences.modeId)
    if (modeId && modeId !== session.capabilities.currentModeId) {
      if (session.capabilities.modes?.some((mode) => mode.modeId === modeId)) {
        try {
          await this.setMode(session.snapshot.agent.id, session.snapshot.session.id, modeId)
        } catch (err) {
          log.warn(
            { err, agentId: session.snapshot.agent.id, sessionId: session.snapshot.session.id, modeId },
            'failed to restore Runtime session mode',
          )
        }
      } else {
        log.warn(
          {
            agentId: session.snapshot.agent.id,
            sessionId: session.snapshot.session.id,
            runtime: session.snapshot.agent.runtime,
            modeId,
          },
          'desired Runtime session mode is unavailable',
        )
      }
    }
    for (const [configId, value] of Object.entries(preferences.config ?? {})) {
      await this.setConfig(session.snapshot.agent.id, session.snapshot.session.id, configId, value)
    }
    void connection
  }

  private async stopAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent) return
    agent.stopping = true
    agent.rejectExit(new Error(`Agent runtime stopped: ${agentId}`))
    this.removeAgentSessions(agentId, agent)
    agent.router.close()
    this.agents.delete(agentId)
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

  private requireAgent(agentId: string): SdkAgentRuntime {
    const agent = this.agents.get(agentId)
    if (!agent) throw new Error(`Runtime Agent not found: ${agentId}`)
    return agent
  }

  private requireSession(sessionId: string, agentId: string): SdkSessionRuntime {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Runtime Session not found: ${sessionId}`)
    if (session.snapshot.agent.id !== agentId) throw new Error(`Runtime Session Agent mismatch: ${sessionId}`)
    return session
  }
}

function initialCapabilities(
  initial: {
    models?: acp.SessionModelState | null
    modes?: acp.SessionModeState | null
    configOptions?: acp.SessionConfigOption[] | null
  },
  agentCapabilities?: acp.AgentCapabilities,
): SessionCapabilities {
  const capabilities: SessionCapabilities = {
    models: initial.models?.availableModels.map((model) => ({
      modelId: model.modelId,
      name: model.name,
      description: model.description ?? undefined,
    })),
    currentModelId: initial.models?.currentModelId,
    modes: initial.modes?.availableModes.map((mode) => ({
      modeId: mode.id,
      name: mode.name,
      description: mode.description ?? undefined,
    })),
    currentModeId: initial.modes?.currentModeId,
    supportsImages: agentCapabilities?.promptCapabilities?.image ?? false,
    supportsAudio: agentCapabilities?.promptCapabilities?.audio ?? false,
  }
  return initial.configOptions
    ? mergeCapabilitiesFromConfig(capabilities, mapConfigOptions(initial.configOptions))
    : capabilities
}
