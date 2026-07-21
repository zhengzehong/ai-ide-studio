import { randomUUID } from 'node:crypto'
import type { RuntimeCancelResult, RuntimeStateSnapshot } from '../../ports/runtime-port.js'
import type { AgentStatus, SessionCapabilities } from '../../types/ws-protocol.js'
import type { TurnUsageData } from '../../types/ws-protocol.js'
import { RuntimeSessionActorScheduler } from '../actors/session-actor.js'
import type { RuntimeCoalescibleUpdate } from '../streams/runtime-update-coalescer.js'
import { SdkRuntimeHost } from './sdk-runtime-host.js'
import type { RuntimeIdleThresholds } from './runtime-idle-sweep.js'

interface RuntimeSession {
  snapshot: RuntimeStateSnapshot
  acpSessionId: string
  capabilities: SessionCapabilities
  cancelled: boolean
  active: boolean
  activeMessageId?: string
  activeTurnId?: string
  completion?: Promise<void>
  lastUsedAt: number
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
  private readonly mockAgents = new Map<string, number>()

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

  get agentCount(): number {
    return this.mockAgents.size + this.sdk.agentCount
  }

  async ensureSession(
    snapshot: RuntimeStateSnapshot,
    options: { emitLifecycle?: boolean } = {},
  ): Promise<string> {
    if (snapshot.agent.runtime !== 'mock') return this.sdk.ensureSession(snapshot, options)
    const emitLifecycle = options.emitLifecycle !== false
    if (!this.mockAgents.has(snapshot.agent.id)) {
      if (emitLifecycle) this.publishLifecycle(snapshot, 'lifecycle.runtime_starting', '正在启动 Agent...')
      this.mockAgents.set(snapshot.agent.id, Date.now())
      this.options.publishAgentStatus?.({ agentId: snapshot.agent.id, status: 'running' })
      if (emitLifecycle) this.publishLifecycle(snapshot, 'lifecycle.runtime_ready', 'Agent 已就绪')
    } else {
      this.mockAgents.set(snapshot.agent.id, Date.now())
    }
    const existing = this.sessions.get(snapshot.session.id)
    if (existing) {
      existing.snapshot = snapshot
      this.touchMockSession(existing)
      return existing.acpSessionId
    }
    const acpSessionId = `mock-session-${randomUUID().slice(0, 8)}`
    if (emitLifecycle) this.publishLifecycle(snapshot, 'lifecycle.session_creating', '正在连接会话...')
    this.sessions.set(snapshot.session.id, {
      snapshot,
      acpSessionId,
      cancelled: false,
      active: false,
      capabilities: {
        models: MOCK_MODELS,
        currentModelId: snapshot.runtimePreferences.modelId ?? 'mock-fast',
        modes: MOCK_MODES,
        currentModeId: snapshot.runtimePreferences.modeId ?? 'default',
      },
      lastUsedAt: Date.now(),
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
    const session = this.requireSession(input.sessionId, input.agentId)
    const messageId = input.diagnostics?.messageId ?? `mock-message-${randomUUID().slice(0, 8)}`
    session.cancelled = false
    session.active = true
    session.activeMessageId = messageId
    session.activeTurnId = input.diagnostics?.turnId
    const pending = this.actors.enqueue(
      input.sessionId,
      async () => {
        this.touchMockSession(session)
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
    const tracked = pending.finally(() => {
      session.active = false
      delete session.activeMessageId
      delete session.activeTurnId
      delete session.completion
      const current = this.sessions.get(input.sessionId)
      if (current) this.touchMockSession(current)
    })
    session.completion = tracked
    return tracked
  }

  async cancelPrompt(agentId: string, sessionId: string): Promise<RuntimeCancelResult> {
    if (this.sdk.hasSession(sessionId)) return this.sdk.cancelPrompt(agentId, sessionId)
    const session = this.sessions.get(sessionId)
    if (!session || session.snapshot.agent.id !== agentId) return { status: 'not-found' }
    session.cancelled = true
    this.touchMockSession(session)
    if (!session.active || !session.activeMessageId) return { status: 'not-active' }
    const result: RuntimeCancelResult = {
      status: 'requested',
      escalation: 'cancel',
      messageId: session.activeMessageId,
      ...(session.activeTurnId ? { turnId: session.activeTurnId } : {}),
    }
    await session.completion
    this.actors.fenceSession(sessionId)
    return result
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
    this.touchMockSession(session)
  }

  async setMode(agentId: string, sessionId: string, modeId: string): Promise<void> {
    if (this.sdk.hasSession(sessionId)) return this.sdk.setMode(agentId, sessionId, modeId)
    const session = this.requireSession(sessionId, agentId)
    if (!MOCK_MODES.some((mode) => mode.modeId === modeId)) throw new Error(`Unknown mock mode: ${modeId}`)
    session.capabilities.currentModeId = modeId
    this.touchMockSession(session)
  }

  async setConfig(agentId: string, sessionId: string, configId: string, value: string | boolean): Promise<void> {
    if (this.sdk.hasSession(sessionId)) return this.sdk.setConfig(agentId, sessionId, configId, value)
    const session = this.requireSession(sessionId, agentId)
    session.snapshot.runtimePreferences.config = {
      ...session.snapshot.runtimePreferences.config,
      [configId]: value,
    }
    this.touchMockSession(session)
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

  async sweepIdle(now: number, thresholds: RuntimeIdleThresholds): Promise<void> {
    for (const [sessionId, session] of [...this.sessions]) {
      if (this.actors.pendingCount(sessionId) > 0 || now - session.lastUsedAt <= thresholds.sessionIdleMs) continue
      this.sessions.delete(sessionId)
      if (this.actors.pendingCount(sessionId) === 0) this.actors.resetSession(sessionId)
      this.publishLifecycle(
        session.snapshot,
        'lifecycle.session_disconnected',
        '\u4f1a\u8bdd\u5df2\u56e0\u7a7a\u95f2\u65ad\u5f00\uff0c\u4e0b\u6b21\u53d1\u9001\u65f6\u4f1a\u81ea\u52a8\u6062\u590d',
      )
    }
    for (const [agentId, lastUsedAt] of [...this.mockAgents]) {
      const ownsSession = [...this.sessions.values()].some((session) => session.snapshot.agent.id === agentId)
      if (ownsSession || now - lastUsedAt <= thresholds.agentIdleMs) continue
      this.mockAgents.delete(agentId)
      this.options.publishAgentStatus?.({ agentId, status: 'standby' })
    }
    await this.sdk.sweepIdle(now, thresholds)
  }

  async close(): Promise<void> {
    await this.drain()
    await this.sdk.close()
    this.sessions.clear()
    for (const agentId of this.mockAgents.keys()) {
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

  private touchMockSession(session: RuntimeSession): void {
    const now = Date.now()
    session.lastUsedAt = now
    this.mockAgents.set(session.snapshot.agent.id, now)
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
