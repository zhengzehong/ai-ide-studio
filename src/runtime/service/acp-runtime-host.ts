import { randomUUID } from 'node:crypto'
import type { RuntimeStateSnapshot } from '../../ports/runtime-port.js'
import type { AgentStatus, SessionCapabilities } from '../../types/ws-protocol.js'
import type { TurnUsageData } from '../../types/ws-protocol.js'
import { RuntimeSessionActorScheduler } from '../actors/session-actor.js'
import type { RuntimeCoalescibleUpdate } from '../streams/runtime-update-coalescer.js'
import { SdkRuntimeHost } from './sdk-runtime-host.js'

interface RuntimeSession {
  snapshot: RuntimeStateSnapshot
  acpSessionId: string
  capabilities: SessionCapabilities
  cancelled: boolean
}

export interface AcpRuntimeHostOptions {
  publishUpdate: (agentId: string, update: RuntimeCoalescibleUpdate) => void
  publishDone: (input: {
    sessionId: string
    agentId: string
    messageId: string
    turnId?: string
    turnUsage?: TurnUsageData
    stopReason: string
  }) => Promise<void>
  publishAgentStatus?: (event: { agentId: string; status: AgentStatus }) => void
  publishCapabilities?: (sessionId: string, capabilities: SessionCapabilities) => void
}

const MOCK_MODELS = [
  { modelId: 'mock-fast', name: 'Mock Fast', description: 'Local fast test model' },
  { modelId: 'mock-smart', name: 'Mock Smart', description: 'Local capability test model' },
]
const MOCK_MODES = [
  { modeId: 'default', name: 'Execution mode', description: 'Execute the user request' },
  { modeId: 'plan', name: 'Plan mode', description: 'Plan before execution' },
]

export class AcpRuntimeHost {
  private readonly sessions = new Map<string, RuntimeSession>()
  private readonly actors = new RuntimeSessionActorScheduler()
  private readonly sdk: SdkRuntimeHost
  private readonly mockAgents = new Set<string>()

  constructor(private readonly options: AcpRuntimeHostOptions) {
    this.sdk = new SdkRuntimeHost(this.actors, options)
  }

  get sessionCount(): number {
    return this.sessions.size + this.sdk.sessionCount
  }

  get actorCount(): number {
    return this.actors.actorCount
  }

  get pendingCommandCount(): number {
    return this.actors.pendingCount()
  }

  async ensureSession(
    snapshot: RuntimeStateSnapshot,
    options: { emitLifecycle?: boolean } = {},
  ): Promise<string> {
    if (snapshot.agent.runtime !== 'mock') return this.sdk.ensureSession(snapshot, options)
    const emitLifecycle = options.emitLifecycle !== false
    if (!this.mockAgents.has(snapshot.agent.id)) {
      if (emitLifecycle) this.publishLifecycle(snapshot, 'lifecycle.runtime_starting', '正在启动 Agent...')
      this.mockAgents.add(snapshot.agent.id)
      this.options.publishAgentStatus?.({ agentId: snapshot.agent.id, status: 'running' })
      if (emitLifecycle) this.publishLifecycle(snapshot, 'lifecycle.runtime_ready', 'Agent 已就绪')
    }
    const existing = this.sessions.get(snapshot.session.id)
    if (existing) {
      existing.snapshot = snapshot
      return existing.acpSessionId
    }
    const acpSessionId = `mock-session-${randomUUID().slice(0, 8)}`
    if (emitLifecycle) this.publishLifecycle(snapshot, 'lifecycle.session_creating', '正在连接会话...')
    this.sessions.set(snapshot.session.id, {
      snapshot,
      acpSessionId,
      cancelled: false,
      capabilities: {
        models: MOCK_MODELS,
        currentModelId: snapshot.runtimePreferences.modelId ?? 'mock-fast',
        modes: MOCK_MODES,
        currentModeId: snapshot.runtimePreferences.modeId ?? 'default',
      },
    })
    if (emitLifecycle) this.publishLifecycle(snapshot, 'lifecycle.session_ready', '会话已连接')
    return acpSessionId
  }

  prompt(input: {
    agentId: string
    sessionId: string
    content: string
    diagnostics?: { turnId?: string; messageId?: string }
  }): Promise<void> {
    if (this.sdk.hasSession(input.sessionId)) return this.sdk.prompt(input)
    return this.actors.enqueue(
      input.sessionId,
      async () => {
        const session = this.requireSession(input.sessionId, input.agentId)
        session.cancelled = false
        const messageId = input.diagnostics?.messageId ?? `mock-message-${randomUUID().slice(0, 8)}`
        const response = `Mock Runtime received: ${input.content}`
        this.options.publishUpdate(input.agentId, {
          kind: 'session-update',
          sessionId: input.sessionId,
          messageId,
          data: { messageId, role: 'agent', thinking: `Thinking about: ${input.content}` },
        })
        for (const contentDelta of chunks(response, 5)) {
          if (session.cancelled) break
          this.options.publishUpdate(input.agentId, {
            kind: 'session-update',
            sessionId: input.sessionId,
            messageId,
            contentDelta,
          })
          await delay(5)
        }
        await this.options.publishDone({
          sessionId: input.sessionId,
          agentId: input.agentId,
          messageId,
          turnId: input.diagnostics?.turnId,
          stopReason: session.cancelled ? 'cancelled' : 'end_turn',
        })
      },
      { payloadBytes: Buffer.byteLength(input.content, 'utf8') },
    )
  }

  async cancelPrompt(agentId: string, sessionId: string): Promise<void> {
    if (this.sdk.hasSession(sessionId)) return this.sdk.cancelPrompt(agentId, sessionId)
    this.requireSession(sessionId, agentId).cancelled = true
  }

  async closeSession(agentId: string, sessionId: string): Promise<void> {
    if (this.sdk.hasSession(sessionId)) return this.sdk.closeSession(agentId, sessionId)
    this.requireSession(sessionId, agentId)
    this.sessions.delete(sessionId)
    if (this.actors.pendingCount(sessionId) === 0) this.actors.resetSession(sessionId)
  }

  async forkSession(snapshot: RuntimeStateSnapshot): Promise<string> {
    if (snapshot.agent.runtime !== 'mock') {
      const source = snapshot.session.acpSessionId
      if (!source) throw new Error(`Source ACP Session is required for fork: ${snapshot.session.id}`)
      return this.sdk.forkSession(snapshot, source)
    }
    return this.ensureSession(snapshot)
  }

  async setModel(agentId: string, sessionId: string, modelId: string): Promise<void> {
    if (this.sdk.hasSession(sessionId)) return this.sdk.setModel(agentId, sessionId, modelId)
    const session = this.requireSession(sessionId, agentId)
    if (!MOCK_MODELS.some((model) => model.modelId === modelId)) throw new Error(`Unknown mock model: ${modelId}`)
    session.capabilities.currentModelId = modelId
  }

  async setMode(agentId: string, sessionId: string, modeId: string): Promise<void> {
    if (this.sdk.hasSession(sessionId)) return this.sdk.setMode(agentId, sessionId, modeId)
    const session = this.requireSession(sessionId, agentId)
    if (!MOCK_MODES.some((mode) => mode.modeId === modeId)) throw new Error(`Unknown mock mode: ${modeId}`)
    session.capabilities.currentModeId = modeId
  }

  async setConfig(agentId: string, sessionId: string, configId: string, value: string | boolean): Promise<void> {
    if (this.sdk.hasSession(sessionId)) return this.sdk.setConfig(agentId, sessionId, configId, value)
    const session = this.requireSession(sessionId, agentId)
    session.snapshot.runtimePreferences.config = {
      ...session.snapshot.runtimePreferences.config,
      [configId]: value,
    }
  }

  getSessionCapabilities(agentId: string, sessionId: string): SessionCapabilities | undefined {
    if (this.sdk.hasSession(sessionId)) return this.sdk.getSessionCapabilities(agentId, sessionId)
    return this.requireSession(sessionId, agentId).capabilities
  }

  resolvePermission(sessionId?: string, requestId?: string, optionId?: string, cancelled?: boolean): boolean {
    return sessionId && requestId ? this.sdk.resolvePermission(sessionId, requestId, optionId, cancelled) : false
  }

  resolveElicitation(
    sessionId?: string,
    requestId?: string,
    action: 'accept' | 'decline' | 'cancel' = 'cancel',
    content?: Record<string, string | number | boolean | string[]>,
  ): boolean {
    return sessionId && requestId ? this.sdk.resolveElicitation(sessionId, requestId, action, content) : false
  }

  drain(): Promise<void> {
    return this.actors.drain()
  }

  async close(): Promise<void> {
    await this.drain()
    await this.sdk.close()
    this.sessions.clear()
    for (const agentId of this.mockAgents) {
      this.options.publishAgentStatus?.({ agentId, status: 'standby' })
    }
    this.mockAgents.clear()
  }

  currentCursor(sessionId: string) {
    return this.actors.currentCursor(sessionId)
  }

  nextCursor(sessionId: string) {
    return this.actors.nextCursor(sessionId)
  }

  private requireSession(sessionId: string, agentId: string): RuntimeSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Runtime Session not found: ${sessionId}`)
    if (session.snapshot.agent.id !== agentId) throw new Error(`Runtime Session Agent mismatch: ${sessionId}`)
    return session
  }

  private publishLifecycle(snapshot: RuntimeStateSnapshot, eventType: string, content: string): void {
    const messageId = `lifecycle-${snapshot.session.id}-${Date.now()}`
    this.options.publishUpdate(snapshot.agent.id, {
      kind: 'session-update',
      sessionId: snapshot.session.id,
      messageId,
      data: { messageId, role: 'system', eventType, content },
    })
  }
}

function chunks(value: string, size: number): string[] {
  const result: string[] = []
  for (let index = 0; index < value.length; index += size) result.push(value.slice(index, index + size))
  return result
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
