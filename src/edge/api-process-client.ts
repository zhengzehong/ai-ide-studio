import { fork, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { AppConfig } from '../core/config.js'
import { createChildLogger } from '../shared/logger.js'
import { resolveApiEntryPath } from './api-entry-url.js'
import {
  isApiToParentMessage,
  type ParentToApiMessage,
} from './protocol.js'

const log = createChildLogger('edge-api-process')

export interface ApiTargets {
  apiUrl?: string
  realtimeUrl?: string
}

export interface CreateApiProcessOptions {
  config: AppConfig
  restartDelayMs?: number
  readyTimeoutMs?: number
}

export interface ApiProcessHandle {
  readonly targets: ApiTargets
  readonly generation: number
  onTargetsChange(listener: (targets: ApiTargets) => void): () => void
  blockForTest(durationMs: number): Promise<void>
  restartRealtimeForTest(): Promise<void>
  terminateForTest(): Promise<void>
  waitForRestart(previousGeneration: number, timeoutMs?: number): Promise<void>
  close(): Promise<void>
}

export async function createApiProcess(options: CreateApiProcessOptions): Promise<ApiProcessHandle> {
  const controller = new ApiProcessController(options)
  await controller.start()
  return controller
}

class ApiProcessController implements ApiProcessHandle {
  private child?: ChildProcess
  private currentTargets: ApiTargets = {}
  private currentGeneration = 0
  private closing = false
  private restartTimer?: NodeJS.Timeout
  private lastFatal?: Error
  private readonly targetListeners = new Set<(targets: ApiTargets) => void>()
  private readonly stateWaiters = new Set<() => void>()
  private readonly exitWaiters = new Set<() => void>()
  private readonly blockRequests = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()
  private readonly realtimeRestartRequests = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()

  constructor(private readonly options: CreateApiProcessOptions) {}

  get targets(): ApiTargets {
    return { ...this.currentTargets }
  }

  get generation(): number {
    return this.currentGeneration
  }

  async start(): Promise<void> {
    this.spawnChild()
    try {
      await this.waitForGeneration(0, this.options.readyTimeoutMs ?? 10_000)
    } catch (error) {
      await this.close()
      throw error
    }
  }

  onTargetsChange(listener: (targets: ApiTargets) => void): () => void {
    this.targetListeners.add(listener)
    listener(this.targets)
    return () => this.targetListeners.delete(listener)
  }

  async blockForTest(durationMs: number): Promise<void> {
    if (!Number.isInteger(durationMs) || durationMs <= 0 || durationMs > 10_000) {
      throw new Error('API block duration must be an integer from 1 to 10000 milliseconds')
    }
    const requestId = randomUUID()
    const completed = new Promise<void>((resolve, reject) => {
      this.blockRequests.set(requestId, { resolve, reject })
    })
    try {
      await this.send({ type: 'test.block', requestId, durationMs })
      await withTimeout(completed, durationMs + 5_000, 'API block acknowledgement timed out')
    } finally {
      this.blockRequests.delete(requestId)
    }
  }

  async terminateForTest(): Promise<void> {
    const child = this.child
    if (!child) return
    const exited = this.waitForChildExit(child)
    child.kill()
    await exited
  }

  async restartRealtimeForTest(): Promise<void> {
    const requestId = randomUUID()
    const completed = new Promise<void>((resolve, reject) => {
      this.realtimeRestartRequests.set(requestId, { resolve, reject })
    })
    try {
      await this.send({ type: 'test.realtime.restart', requestId })
      await withTimeout(completed, 10_000, 'Realtime restart acknowledgement timed out')
    } finally {
      this.realtimeRestartRequests.delete(requestId)
    }
  }

  waitForRestart(previousGeneration: number, timeoutMs = 10_000): Promise<void> {
    return this.waitForGeneration(previousGeneration, timeoutMs)
  }

  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    const child = this.child
    if (child && child.exitCode == null && child.signalCode == null) {
      const exited = this.waitForChildExit(child)
      await this.send({ type: 'stop' }).catch(() => undefined)
      await Promise.race([exited, delay(5_000)])
      if (child.exitCode == null && child.signalCode == null) child.kill()
      await Promise.race([exited, delay(1_000)])
    }
    this.child = undefined
    this.clearTargets()
    this.rejectBlockRequests(new Error('API process closed'))
    this.rejectRealtimeRestartRequests(new Error('API process closed'))
    this.targetListeners.clear()
    this.wakeStateWaiters()
  }

  private spawnChild(): void {
    if (this.closing) return
    this.lastFatal = undefined
    const entry = resolveApiEntryPath(import.meta.url)
    const child = fork(entry, [], {
      env: process.env,
      execArgv: entry.endsWith('.ts') ? ['--import', 'tsx'] : undefined,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
    this.child = child
    child.on('message', (message: unknown) => {
      void this.handleMessage(child, message).catch((error) => {
        log.error({ err: error, pid: child.pid, generation: this.currentGeneration }, 'API process message handling failed')
        if (child.exitCode == null && child.signalCode == null) child.kill()
      })
    })
    child.once('error', (error) => log.error({ err: error }, 'API process error'))
    child.once('exit', (code, signal) => this.handleExit(child, code, signal))
  }

  private async handleMessage(child: ChildProcess, message: unknown): Promise<void> {
    if (this.child !== child || !isApiToParentMessage(message)) return
    if (message.type === 'hello') {
      await this.send({ type: 'start', config: internalConfig(this.options.config) })
      return
    }
    if (message.type === 'ready') {
      this.currentTargets = { apiUrl: message.apiUrl, realtimeUrl: message.realtimeUrl }
      this.currentGeneration += 1
      this.lastFatal = undefined
      this.notifyTargets()
      this.wakeStateWaiters()
      log.info({ generation: this.currentGeneration }, 'API process ready')
      return
    }
    if (message.type === 'realtime.changed') {
      this.currentTargets = { ...this.currentTargets, realtimeUrl: message.realtimeUrl }
      this.notifyTargets()
      return
    }
    if (message.type === 'test.block.done') {
      this.blockRequests.get(message.requestId)?.resolve()
      return
    }
    if (message.type === 'test.realtime.restart.done') {
      this.realtimeRestartRequests.get(message.requestId)?.resolve()
      return
    }
    if (message.type === 'fatal') {
      this.lastFatal = new Error(message.message)
      this.wakeStateWaiters()
      log.error({ message: message.message }, 'API child reported fatal error')
    }
  }

  private handleExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child !== child) return
    this.child = undefined
    for (const resolve of this.exitWaiters) resolve()
    this.exitWaiters.clear()
    this.clearTargets()
    this.rejectBlockRequests(new Error('API process exited'))
    this.rejectRealtimeRestartRequests(new Error('API process exited'))
    if (this.closing) return
    log.warn({ code, signal }, 'API process exited; scheduling restart')
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      this.spawnChild()
    }, this.options.restartDelayMs ?? 250)
  }

  private send(message: ParentToApiMessage): Promise<void> {
    const child = this.child
    if (!child?.connected) return Promise.reject(new Error('API process IPC is unavailable'))
    return new Promise((resolve, reject) => {
      child.send(message, (error) => error ? reject(error) : resolve())
    })
  }

  private clearTargets(): void {
    if (!this.currentTargets.apiUrl && !this.currentTargets.realtimeUrl) return
    this.currentTargets = {}
    this.notifyTargets()
  }

  private notifyTargets(): void {
    const snapshot = this.targets
    for (const listener of this.targetListeners) {
      try {
        listener(snapshot)
      } catch (error) {
        log.warn({ err: error }, 'API target listener failed')
      }
    }
  }

  private waitForGeneration(previousGeneration: number, timeoutMs: number): Promise<void> {
    if (this.currentGeneration > previousGeneration) return Promise.resolve()
    return withTimeout(new Promise<void>((resolve, reject) => {
      const check = (): void => {
        if (this.currentGeneration > previousGeneration) resolve()
        else if (this.lastFatal) reject(this.lastFatal)
        else this.stateWaiters.add(check)
      }
      this.stateWaiters.add(check)
    }), timeoutMs, 'API process readiness timed out')
  }

  private wakeStateWaiters(): void {
    const waiters = [...this.stateWaiters]
    this.stateWaiters.clear()
    for (const wake of waiters) wake()
  }

  private waitForChildExit(child: ChildProcess): Promise<void> {
    if (child.exitCode != null || child.signalCode != null || this.child !== child) return Promise.resolve()
    return new Promise((resolve) => this.exitWaiters.add(resolve))
  }

  private rejectBlockRequests(error: Error): void {
    for (const pending of this.blockRequests.values()) pending.reject(error)
    this.blockRequests.clear()
  }

  private rejectRealtimeRestartRequests(error: Error): void {
    for (const pending of this.realtimeRestartRequests.values()) pending.reject(error)
    this.realtimeRestartRequests.clear()
  }
}

function internalConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    host: '127.0.0.1',
    port: 0,
    edgeMode: 'internal',
    edgeRealtimePath: config.edgeRealtimePath ?? '/realtime',
    realtimeHost: '127.0.0.1',
    realtimePort: 0,
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    delay(timeoutMs).then(() => { throw new Error(message) }),
  ])
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
