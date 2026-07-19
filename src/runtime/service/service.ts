import { createConnection, type Socket } from 'node:net'
import { FramedSocket } from '../../ipc/framed-socket.js'
import type { IpcEnvelope } from '../../ipc/protobuf-envelope.js'
import type { ServerMessage, SessionUpdateData, TurnUsageData } from '../../types/ws-protocol.js'
import { RuntimeUpdateCoalescer, type RuntimeCoalescibleUpdate } from '../streams/runtime-update-coalescer.js'
import { AcpRuntimeHost } from './acp-runtime-host.js'
import type { RuntimeCommand, RuntimeDoneEvent, RuntimePersistenceUpdate, RuntimeStreamPayload } from './protocol.js'
import { isRuntimeStreamPayload } from './protocol.js'
import {
  createEventLoopMonitor,
  eventLoopMonitorOptions,
  type EventLoopMonitor,
} from '../../shared/event-loop-monitor.js'

export interface RuntimeServiceOptions {
  streamEndpoint: string
  streamToken: string
  maxFrameBytes: number
  sendPersistence: (event: RuntimePersistenceUpdate) => Promise<void>
  sendDone: (event: RuntimeDoneEvent) => Promise<void>
}

export class RuntimeService {
  private readonly cursorByUpdate = new Map<string, { streamGeneration: string; sequence: number }>()
  private readonly coalescer: RuntimeUpdateCoalescer
  private readonly host: AcpRuntimeHost
  private readonly eventLoopMonitor: EventLoopMonitor
  private stream?: FramedSocket

  constructor(private readonly options: RuntimeServiceOptions) {
    this.host = new AcpRuntimeHost({
      publishUpdate: (agentId, update) => this.publishUpdate(agentId, update),
      publishDone: (input) => this.publishDone(input),
    })
    this.coalescer = new RuntimeUpdateCoalescer({
      emitUi: (updates) => this.emitUi(updates),
      emitPersistence: (updates) => this.emitPersistence(updates),
    })
    this.eventLoopMonitor = createEventLoopMonitor(
      eventLoopMonitorOptions('runtime', () => ({
        sessionCount: this.host.sessionCount,
        actorCount: this.host.actorCount,
        pendingCommandCount: this.host.pendingCommandCount,
        pendingUpdateCount: this.coalescer.pendingCount,
      })),
    )
  }

  async start(): Promise<void> {
    const socket = await connect(this.options.streamEndpoint)
    this.stream = new FramedSocket(socket, { maxFrameBytes: this.options.maxFrameBytes })
    const ready = new Promise<void>((resolve, reject) => {
      this.stream?.onMessage((envelope) => {
        if (!isRuntimeStreamPayload(envelope.payload)) return
        if (envelope.payload.type === 'runtime.hello.ack') resolve()
      })
      this.stream?.onError(reject)
    })
    await this.sendStream({ type: 'runtime.hello', token: this.options.streamToken })
    await ready
    this.eventLoopMonitor.start()
  }

  async execute(command: RuntimeCommand): Promise<unknown> {
    switch (command.operation) {
      case 'ensure':
        return this.host.ensureSession(command.snapshot)
      case 'prompt':
        return this.host.prompt(command)
      case 'cancel':
        return this.host.cancelPrompt(command.agentId, command.sessionId)
      case 'close-session':
        return this.host.closeSession(command.agentId, command.sessionId)
      case 'fork':
        command.snapshot.session.acpSessionId = command.sourceAcpSessionId
        return this.host.forkSession(command.snapshot)
      case 'set-model':
        return this.host.setModel(command.agentId, command.sessionId, command.modelId)
      case 'set-mode':
        return this.host.setMode(command.agentId, command.sessionId, command.modeId)
      case 'set-config':
        return this.host.setConfig(command.agentId, command.sessionId, command.configId, command.value)
      case 'capabilities':
        return this.host.getSessionCapabilities(command.agentId, command.sessionId)
      case 'permission':
        return this.host.resolvePermission(command.sessionId, command.requestId, command.optionId, command.cancelled)
      case 'elicitation':
        return this.host.resolveElicitation(command.sessionId, command.requestId, command.action, command.content)
      case 'drain':
        await this.host.drain()
        await this.coalescer.drain()
        return undefined
    }
  }

  async close(): Promise<void> {
    this.eventLoopMonitor.stop()
    await this.host.close()
    await this.coalescer.drain()
    this.coalescer.close()
    await this.stream?.close()
  }

  private publishUpdate(agentId: string, update: RuntimeCoalescibleUpdate): void {
    this.coalescer.enqueue({ ...update, agentId })
  }

  private async publishDone(input: {
    sessionId: string
    agentId: string
    messageId: string
    turnId?: string
    turnUsage?: TurnUsageData
    stopReason: string
  }): Promise<void> {
    await this.coalescer.flushSession(input.sessionId)
    const cursor = this.host.nextCursor(input.sessionId)
    await this.options.sendDone({ ...input, ...cursor })
  }

  private async emitUi(updates: RuntimeCoalescibleUpdate[]): Promise<void> {
    for (const update of updates) {
      const cursor = this.host.nextCursor(update.sessionId)
      this.cursorByUpdate.set(updateKey(update), cursor)
      await this.sendStream({ type: 'runtime.stream', message: toServerMessage(update, cursor) })
    }
  }

  private async emitPersistence(updates: RuntimeCoalescibleUpdate[]): Promise<void> {
    for (const update of updates) {
      const cursor = this.cursorByUpdate.get(updateKey(update)) ?? this.host.nextCursor(update.sessionId)
      await this.options.sendPersistence({
        sessionId: update.sessionId,
        agentId: stringField(update, 'agentId'),
        update,
        ...cursor,
      })
    }
  }

  private sendStream(payload: RuntimeStreamPayload): Promise<void> {
    if (!this.stream) return Promise.reject(new Error('Runtime stream is unavailable'))
    return this.stream.send(toEnvelope(payload))
  }
}

function toServerMessage(
  update: RuntimeCoalescibleUpdate,
  cursor: { streamGeneration: string; sequence: number },
): ServerMessage {
  const nested = update.data
  const data: SessionUpdateData =
    nested && typeof nested === 'object' && !Array.isArray(nested)
      ? {
          ...(nested as SessionUpdateData),
          ...(typeof update.contentDelta === 'string'
            ? { contentDelta: `${stringValue((nested as Record<string, unknown>).contentDelta)}${update.contentDelta}` }
            : {}),
        }
      : {
          messageId: update.messageId,
          role: 'agent',
          ...(typeof update.contentDelta === 'string' ? { contentDelta: update.contentDelta } : {}),
        }
  return {
    type: 'session:update',
    sessionId: update.sessionId,
    agentId: stringField(update, 'agentId'),
    data,
    ...cursor,
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function updateKey(update: RuntimeCoalescibleUpdate): string {
  if (update.kind === 'process-item') return `${update.sessionId}:process:${update.processItemId}`
  if (update.kind === 'session-update') {
    const data = update.data
    const nested =
      data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined
    if (typeof update.contentDelta === 'string' || typeof nested?.contentDelta === 'string') {
      return `${update.sessionId}:${update.kind}:${update.messageId}:text`
    }
    if (typeof nested?.thinking === 'string') return `${update.sessionId}:${update.kind}:${update.messageId}:thinking`
  }
  return `${update.sessionId}:${update.kind}:${update.messageId}`
}

function stringField(value: RuntimeCoalescibleUpdate, key: string): string {
  const field = value[key]
  return typeof field === 'string' ? field : ''
}

function toEnvelope(payload: RuntimeStreamPayload): IpcEnvelope {
  return {
    version: '1',
    kind: payload.type,
    timestamp: Date.now(),
    payload: payload as unknown as Record<string, unknown>,
  }
}

function connect(endpoint: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint)
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}
