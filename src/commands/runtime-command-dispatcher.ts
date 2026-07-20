import { createChildLogger } from '../core/logger.js'
import type {
  RuntimeCommandEnqueueResult,
  RuntimeCommandInput,
  RuntimeCommandRecord,
  RuntimeCommandUpdate,
  WriteDataPort,
} from '../ports/write-data-port.js'
import { parseSessionCommand, type SessionCommand } from './session-command-types.js'

const log = createChildLogger('runtime-command-dispatcher')
const RECOVERY_PAGE_SIZE = 1000

export type RuntimeCommandLedgerPort = Pick<
  WriteDataPort,
  'enqueueRuntimeCommand' | 'listRecoverableRuntimeCommands' | 'updateRuntimeCommand'
>

export interface RuntimeCommandSubmission {
  command: RuntimeCommandRecord
  duplicate: boolean
  completion: Promise<RuntimeCommandRecord>
}

export interface RuntimeCommandDispatcherOptions {
  ledger: RuntimeCommandLedgerPort
  execute: (command: SessionCommand) => Promise<void>
  now?: () => string
}

export class RuntimeCommandConflictError extends Error {
  constructor(commandId: string) {
    super(`幂等键已用于不同命令: ${commandId}`)
    this.name = 'RuntimeCommandConflictError'
  }
}

export class RuntimeCommandUnavailableError extends Error {
  constructor() {
    super('命令服务暂不可用')
    this.name = 'RuntimeCommandUnavailableError'
  }
}

export class RuntimeCommandDispatcher {
  private readonly ledger: RuntimeCommandLedgerPort
  private readonly execute: RuntimeCommandDispatcherOptions['execute']
  private readonly now: () => string
  private readonly laneTails = new Map<string, Promise<void>>()
  private readonly completionByCommand = new Map<string, Promise<RuntimeCommandRecord>>()
  private accepting = false
  private started = false

  constructor(options: RuntimeCommandDispatcherOptions) {
    this.ledger = options.ledger
    this.execute = options.execute
    this.now = options.now ?? (() => new Date().toISOString())
  }

  async start(): Promise<void> {
    if (this.started) return
    const recoverable: RuntimeCommandRecord[] = []
    let after: { createdAt: string; commandId: string } | undefined
    while (true) {
      const page = await this.ledger.listRecoverableRuntimeCommands({
        limit: RECOVERY_PAGE_SIZE,
        ...(after ? { after } : {}),
      })
      recoverable.push(...page)
      if (page.length < RECOVERY_PAGE_SIZE) break
      const last = page.at(-1)
      if (!last) break
      after = { createdAt: last.createdAt, commandId: last.commandId }
    }
    this.started = true
    this.accepting = true
    for (const command of recoverable) this.schedule(command)
    log.info({ recoverableCount: recoverable.length }, 'Runtime command dispatcher started')
  }

  async submit(input: RuntimeCommandInput): Promise<RuntimeCommandSubmission> {
    if (!this.started || !this.accepting) throw new RuntimeCommandUnavailableError()
    const result = await this.ledger.enqueueRuntimeCommand(input)
    if (result.conflict) throw new RuntimeCommandConflictError(result.command.commandId)
    const completion = this.completionFor(result)
    return { command: result.command, duplicate: result.duplicate, completion }
  }

  closeIntake(): void {
    this.accepting = false
  }

  async drain(): Promise<void> {
    while (this.laneTails.size > 0) {
      await Promise.allSettled([...this.laneTails.values()])
    }
  }

  private completionFor(result: RuntimeCommandEnqueueResult): Promise<RuntimeCommandRecord> {
    if (result.command.status === 'completed'
      || result.command.status === 'failed'
      || result.command.status === 'interrupted') {
      return result.command.status === 'completed'
        ? Promise.resolve(result.command)
        : Promise.reject(new Error(result.command.error ?? `命令状态: ${result.command.status}`))
    }
    return this.schedule(result.command)
  }

  private schedule(command: RuntimeCommandRecord): Promise<RuntimeCommandRecord> {
    const existing = this.completionByCommand.get(command.commandId)
    if (existing) return existing

    const lane = commandLane(command)
    const previous = this.laneTails.get(lane) ?? Promise.resolve()
    const completion = previous
      .catch(() => undefined)
      .then(() => this.run(command))
    void completion.catch(() => undefined)
    this.completionByCommand.set(command.commandId, completion)

    const tail = completion.then(() => undefined, () => undefined)
    this.laneTails.set(lane, tail)
    void tail.finally(() => {
      if (this.laneTails.get(lane) === tail) {
        this.laneTails.delete(lane)
      }
      this.completionByCommand.delete(command.commandId)
    })
    return completion
  }

  private async run(command: RuntimeCommandRecord): Promise<RuntimeCommandRecord> {
    const startedAt = Date.now()
    if (shouldInterruptRecoveredPrompt(command)) {
      const interrupted = await this.update({
        commandId: command.commandId,
        status: 'interrupted',
        error: 'API 重启时命令已写入用户消息，禁止重复执行',
      })
      log.warn(commandContext(interrupted, startedAt), 'Recovered Runtime command interrupted')
      return interrupted
    }

    const parsed = parseSessionCommand(command.payload)
    if (parsed.commandId !== command.commandId || parsed.sessionId !== command.sessionId) {
      throw new Error(`Runtime command envelope mismatch: ${command.commandId}`)
    }
    const running = await this.update({ commandId: command.commandId, status: 'running' })
    try {
      await this.execute(parsed)
      const completed = await this.update({ commandId: command.commandId, status: 'completed' })
      log.info(commandContext(completed, startedAt), 'Runtime command completed')
      return completed
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failed = await this.update({
        commandId: command.commandId,
        status: 'failed',
        error: message,
      })
      log.error({ err: error, ...commandContext(failed, startedAt) }, 'Runtime command failed')
      throw error
    } finally {
      void running
    }
  }

  private update(input: Omit<RuntimeCommandUpdate, 'updatedAt'>): Promise<RuntimeCommandRecord> {
    return this.ledger.updateRuntimeCommand({ ...input, updatedAt: this.now() })
  }
}

function commandLane(command: RuntimeCommandRecord): string {
  let lane: 'turn' | 'interaction' | 'cancel' | 'read-state'
  switch (command.type) {
    case 'prompt':
      lane = 'turn'
      break
    case 'permission.respond':
    case 'elicitation.respond':
      lane = 'interaction'
      break
    case 'session.cancel':
      lane = 'cancel'
      break
    case 'sessions.markRead':
      lane = 'read-state'
      break
  }
  return `${command.sessionId}:${lane}`
}

function shouldInterruptRecoveredPrompt(command: RuntimeCommandRecord): boolean {
  return command.type === 'prompt'
    && command.status === 'running'
    && command.humanMessagePersisted
}

function commandContext(command: RuntimeCommandRecord, startedAt: number): Record<string, unknown> {
  return {
    commandId: command.commandId,
    sessionId: command.sessionId,
    type: command.type,
    status: command.status,
    attempts: command.attempts,
    elapsedMs: Date.now() - startedAt,
  }
}
