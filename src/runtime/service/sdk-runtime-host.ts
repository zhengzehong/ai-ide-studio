import { spawn, type ChildProcess } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { mapConfigOptions, mergeCapabilitiesFromConfig } from '../../acp/capabilities.js'
import type { RuntimeStateSnapshot } from '../../ports/runtime-port.js'
import type { ImageAttachment, SessionCapabilities, TurnUsageData } from '../../types/ws-protocol.js'
import type { RuntimeSessionActorScheduler } from '../actors/session-actor.js'
import { ResourceGovernor } from '../resources/resource-governor.js'
import type { RuntimeCoalescibleUpdate } from '../streams/runtime-update-coalescer.js'
import { createAcpRuntimeClient, type AcpRuntimeClientRouter } from './acp-runtime-client.js'

interface SdkAgentRuntime {
  fingerprint: string
  process: ChildProcess
  connection: acp.ClientSideConnection
  router: AcpRuntimeClientRouter
  agentCapabilities?: acp.AgentCapabilities
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

export class SdkRuntimeHost {
  private readonly agents = new Map<string, SdkAgentRuntime>()
  private readonly sessions = new Map<string, SdkSessionRuntime>()
  private readonly resources = new ResourceGovernor()

  constructor(
    private readonly actors: RuntimeSessionActorScheduler,
    private readonly options: SdkRuntimeHostOptions,
  ) {}

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
          const result = await agent.connection.prompt({ sessionId: session.acpSessionId, prompt: blocks })
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
    const session = this.requireSession(sessionId, agentId)
    await this.requireAgent(agentId).connection.cancel({ sessionId: session.acpSessionId })
  }

  async closeSession(agentId: string, sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId, agentId)
    const agent = this.requireAgent(agentId)
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
    const command = snapshot.runtime.command
    if (!command) throw new Error(`Runtime command is missing for ${snapshot.agent.runtime}`)
    const process = spawn(command.cmd, command.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: snapshot.runtime.env,
      shell: globalThis.process.platform === 'win32',
    })
    const router = createAcpRuntimeClient({
      agentId: snapshot.agent.id,
      resources: this.resources,
      publishUpdate: (update) => this.options.publishUpdate(snapshot.agent.id, update),
      updateCapabilities: (sessionId, update) => {
        const session = this.sessions.get(sessionId)
        if (session) session.capabilities = update(session.capabilities)
      },
    })
    const stream = acp.ndJsonStream(
      Writable.toWeb(process.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(process.stdout!) as ReadableStream<Uint8Array>,
    )
    const connection = new acp.ClientSideConnection(() => router.client, stream)
    const initialized = await connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
        elicitation: { form: {}, url: {} },
      },
      clientInfo: { name: 'ai-ide-studio-runtime', version: '0.2.0' },
    })
    const runtime: SdkAgentRuntime = {
      fingerprint,
      process,
      connection,
      router,
      agentCapabilities: initialized.agentCapabilities ?? undefined,
    }
    this.agents.set(snapshot.agent.id, runtime)
    process.once('exit', () => {
      if (this.agents.get(snapshot.agent.id) === runtime) this.agents.delete(snapshot.agent.id)
    })
    return runtime
  }

  private async applyPreferences(connection: acp.ClientSideConnection, session: SdkSessionRuntime): Promise<void> {
    const preferences = session.snapshot.runtimePreferences
    if (preferences.modelId)
      await this.setModel(session.snapshot.agent.id, session.snapshot.session.id, preferences.modelId)
    if (preferences.modeId)
      await this.setMode(session.snapshot.agent.id, session.snapshot.session.id, preferences.modeId)
    for (const [configId, value] of Object.entries(preferences.config ?? {})) {
      await this.setConfig(session.snapshot.agent.id, session.snapshot.session.id, configId, value)
    }
    void connection
  }

  private async stopAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent) return
    agent.router.close()
    agent.process.kill()
    this.agents.delete(agentId)
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
