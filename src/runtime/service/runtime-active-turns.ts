import type { RuntimeCancelEscalation, RuntimeCancelResult } from '../../ports/runtime-port.js'
import { createChildLogger } from '../../shared/logger.js'
import type { ImageAttachment } from '../../types/ws-protocol.js'
import type { RuntimeSessionActorScheduler } from '../actors/session-actor.js'
import { enqueueSdkPrompt } from './sdk-runtime-prompt.js'
import { requireSdkAgent, requireSdkSession, touchSdkSession } from './sdk-runtime-state.js'
import type { SdkAgentRuntime, SdkRuntimeHostOptions, SdkSessionRuntime } from './sdk-runtime-types.js'

const log = createChildLogger('runtime-active-turns')

export interface RuntimeActiveTurn {
  sessionId: string
  agentId: string
  messageId: string
  turnId?: string
  generation: string
  /** 合成(自治)回合:不在 ACP 绑定上带 generation,但同样可被 cancel 中断。 */
  synthetic?: boolean
  /** cancel 请求到达时的回调(合成回合据此进入快速收敛模式)。 */
  onCancelRequested?: () => void
  cancelRequested: boolean
  settled: Promise<void>
  terminal?: Promise<void>
  resolveSettled: () => void
  rejectSettled: (error: Error) => void
}

export interface RuntimeCancelTimings {
  cancelGraceMs: number
  closeGraceMs: number
  restartGraceMs: number
}

export class RuntimeActiveTurns {
  private readonly turns = new Map<string, RuntimeActiveTurn>()

  begin(input: Omit<RuntimeActiveTurn, 'cancelRequested' | 'settled' | 'terminal' | 'resolveSettled' | 'rejectSettled'>): RuntimeActiveTurn {
    if (this.turns.has(input.sessionId)) throw new Error(`Runtime turn already active: ${input.sessionId}`)
    let resolveSettled: (() => void) | undefined
    let rejectSettled: ((error: Error) => void) | undefined
    const settled = new Promise<void>((resolve, reject) => {
      resolveSettled = resolve
      rejectSettled = reject
    })
    void settled.catch(() => undefined)
    const turn: RuntimeActiveTurn = {
      ...input,
      cancelRequested: false,
      settled,
      resolveSettled: resolveSettled!,
      rejectSettled: rejectSettled!,
    }
    this.turns.set(input.sessionId, turn)
    return turn
  }

  requestCancel(sessionId: string): RuntimeActiveTurn | undefined {
    const turn = this.turns.get(sessionId)
    if (turn) {
      turn.cancelRequested = true
      try {
        turn.onCancelRequested?.()
      } catch (error) {
        log.warn({ err: error, sessionId }, 'turn cancel callback failed')
      }
    }
    return turn
  }

  isCurrent(sessionId: string, generation: string): boolean {
    const turn = this.turns.get(sessionId)
    return turn?.generation === generation && !turn.terminal
  }

  has(sessionId: string): boolean {
    return this.turns.has(sessionId)
  }

  async publishTerminal(turn: RuntimeActiveTurn, publish: () => Promise<void>): Promise<boolean> {
    if (this.turns.get(turn.sessionId) !== turn) return false
    if (turn.terminal) {
      await turn.terminal
      return false
    }
    turn.terminal = publish()
    await turn.terminal
    return true
  }

  finish(turn: RuntimeActiveTurn, error?: unknown): void {
    if (this.turns.get(turn.sessionId) !== turn) return
    this.turns.delete(turn.sessionId)
    if (error) turn.rejectSettled(asError(error))
    else turn.resolveSettled()
  }

  async waitForAgentIdle(agentId: string): Promise<void> {
    while (true) {
      const active = [...this.turns.values()].filter((turn) => turn.agentId === agentId)
      if (active.length === 0) return
      await Promise.allSettled(active.map((turn) => turn.settled))
    }
  }
}

export class SdkRuntimeTurns {
  private readonly active = new RuntimeActiveTurns()

  constructor(private readonly options: {
    actors: RuntimeSessionActorScheduler
    agents: Map<string, SdkAgentRuntime>
    sessions: Map<string, SdkSessionRuntime>
    host: SdkRuntimeHostOptions
    timings: RuntimeCancelTimings
    restartAgent: (agentId: string) => Promise<void>
  }) {}

  prompt(prompt: Parameters<typeof enqueueTrackedSdkPrompt>[0]['prompt']): Promise<void> {
    return enqueueTrackedSdkPrompt({
      actors: this.options.actors,
      turns: this.active,
      agents: this.options.agents,
      sessions: this.options.sessions,
      options: this.options.host,
      prompt,
    })
  }

  cancel(agentId: string, sessionId: string): Promise<RuntimeCancelResult> {
    return cancelSdkActiveTurn({
      agentId,
      sessionId,
      sessions: this.options.sessions,
      agents: this.options.agents,
      turns: this.active,
      timings: this.options.timings,
      restartAgent: () => this.options.restartAgent(agentId),
      fenceSession: () => this.options.actors.fenceSession(sessionId),
      touchSession: (session) => touchSdkSession(this.options.agents, session),
    })
  }

  /** 登记一个合成(自治)回合:无 generation 绑定,但仍可被 cancel 中断、被 waitForAgentIdle 等待。 */
  beginSyntheticTurn(input: {
    sessionId: string
    agentId: string
    messageId: string
    onCancelRequested?: () => void
  }): RuntimeActiveTurn {
    return this.active.begin({
      sessionId: input.sessionId,
      agentId: input.agentId,
      messageId: input.messageId,
      generation: `synthetic:${input.messageId}`,
      synthetic: true,
      onCancelRequested: input.onCancelRequested,
    })
  }

  /** 合成回合结算:解除 waitForAgentIdle 挂起,让 cancel 升级阶梯观察到本轮已终止。 */
  finishSyntheticTurn(turn: RuntimeActiveTurn): void {
    this.active.finish(turn)
  }

  /** 该会话是否有在册回合(真或合成):用于 session.active 的权威重算。 */
  hasActiveTurn(sessionId: string): boolean {
    return this.active.has(sessionId)
  }

  acceptsUpdate(sessionId: string, streamGeneration: string): boolean {
    return this.active.isCurrent(sessionId, streamGeneration)
  }

  waitForAgentIdle(agentId: string): Promise<void> {
    return this.active.waitForAgentIdle(agentId)
  }
}

export function enqueueTrackedSdkPrompt(input: {
  actors: RuntimeSessionActorScheduler
  turns: RuntimeActiveTurns
  agents: Map<string, SdkAgentRuntime>
  sessions: Map<string, SdkSessionRuntime>
  options: SdkRuntimeHostOptions
  prompt: {
    agentId: string
    sessionId: string
    content: string
    images?: ImageAttachment[]
    diagnostics?: { turnId?: string; messageId?: string }
  }
}): Promise<void> {
  const { agentId, sessionId } = input.prompt
  touchSdkSession(input.agents, requireSdkSession(input.sessions, sessionId, agentId))
  const streamGeneration = input.actors.currentCursor(sessionId).streamGeneration
  const turn = input.turns.begin({
    sessionId,
    agentId,
    messageId: input.prompt.diagnostics?.messageId ?? `message-${Date.now()}`,
    turnId: input.prompt.diagnostics?.turnId,
    generation: streamGeneration,
  })
  let failure: unknown
  return enqueueSdkPrompt({
    actors: input.actors,
    ...input.prompt,
    diagnostics: { ...input.prompt.diagnostics, messageId: turn.messageId },
    streamGeneration,
    isCancelRequested: () => turn.cancelRequested,
    getSession: () => requireSdkSession(input.sessions, sessionId, agentId),
    getAgent: () => requireSdkAgent(input.agents, agentId),
    publishDone: async (event) => {
      await input.turns.publishTerminal(turn, () => input.options.publishDone(event))
    },
  }).catch((error: unknown) => {
    failure = error
    throw error
  }).finally(() => {
    input.turns.finish(turn, failure)
    const session = input.sessions.get(sessionId)
    if (session) touchSdkSession(input.agents, session)
  })
}

export async function cancelSdkActiveTurn(input: {
  agentId: string
  sessionId: string
  sessions: Map<string, SdkSessionRuntime>
  agents: Map<string, SdkAgentRuntime>
  turns: RuntimeActiveTurns
  timings: RuntimeCancelTimings
  restartAgent: () => Promise<void>
  fenceSession: () => void
  touchSession: (session: SdkSessionRuntime) => void
}): Promise<RuntimeCancelResult> {
  const session = input.sessions.get(input.sessionId)
  if (!session || session.snapshot.agent.id !== input.agentId) return { status: 'not-found' }
  const agent = input.agents.get(input.agentId)
  if (!agent) return { status: 'not-found' }

  agent.router.cancelSession(input.sessionId)
  input.touchSession(session)
  const turn = input.turns.requestCancel(input.sessionId)
  if (!turn) return { status: 'not-active' }

  bestEffort(
    () => agent.connection.cancel({ sessionId: session.acpSessionId }),
    { agentId: input.agentId, sessionId: input.sessionId, operation: 'cancel' },
  )
  if (await settlesWithin(turn, input.timings.cancelGraceMs)) {
    input.fenceSession()
    return result(turn, 'cancel')
  }

  log.warn({ agentId: input.agentId, sessionId: input.sessionId }, 'ACP cancel did not terminate turn; closing Session')
  bestEffort(
    () => agent.connection.closeSession({ sessionId: session.acpSessionId }),
    { agentId: input.agentId, sessionId: input.sessionId, operation: 'close-session' },
  )
  if (await settlesWithin(turn, input.timings.closeGraceMs)) {
    agent.router.unbindSession(input.sessionId)
    input.sessions.delete(input.sessionId)
    input.fenceSession()
    return result(turn, 'session-close')
  }

  log.warn({ agentId: input.agentId, sessionId: input.sessionId }, 'ACP Session close did not terminate turn; restarting Agent')
  await input.restartAgent()
  if (!await settlesWithin(turn, input.timings.restartGraceMs)) {
    throw new Error(`Runtime turn did not terminate after Agent restart: ${input.sessionId}`)
  }
  input.fenceSession()
  return result(turn, 'agent-restart')
}

function result(turn: RuntimeActiveTurn, escalation: RuntimeCancelEscalation): RuntimeCancelResult {
  return {
    status: 'requested',
    escalation,
    messageId: turn.messageId,
    ...(turn.turnId ? { turnId: turn.turnId } : {}),
  }
}

async function settlesWithin(turn: RuntimeActiveTurn, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    timer.unref?.()
    void turn.settled.then(
      () => {
        clearTimeout(timer)
        resolve(true)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function bestEffort(work: () => Promise<unknown>, context: Record<string, unknown>): void {
  try {
    void work().catch((error) => log.debug({ err: error, ...context }, 'ACP cancellation operation failed'))
  } catch (error) {
    log.debug({ err: error, ...context }, 'ACP cancellation operation failed')
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
