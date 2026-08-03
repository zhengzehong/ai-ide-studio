export type RuntimeCoalescibleUpdate =
  | {
      kind: 'session-update'
      sessionId: string
      messageId: string
      contentDelta?: string
      [key: string]: unknown
    }
  | {
      kind: 'process-item'
      sessionId: string
      messageId: string
      processItemId: string
      [key: string]: unknown
    }
  | {
      kind: 'interaction'
      sessionId: string
      messageId: string
      interactionType: 'permission' | 'elicitation'
      [key: string]: unknown
    }
  | {
      kind: 'done'
      sessionId: string
      messageId: string
      [key: string]: unknown
    }

export interface RuntimeUpdateCoalescerOptions {
  uiFlushMs?: number
  persistenceFlushMs?: number
  emitUi: (updates: RuntimeCoalescibleUpdate[]) => Promise<void>
  emitPersistence: (updates: RuntimeCoalescibleUpdate[]) => Promise<void>
}

interface UpdateChannel {
  pending: Map<string, RuntimeCoalescibleUpdate>
  timer?: NodeJS.Timeout
  flushMs: number
  emit: (updates: RuntimeCoalescibleUpdate[]) => Promise<void>
  writeChain: Promise<void>
}

export class RuntimeUpdateCoalescer {
  private readonly ui: UpdateChannel
  private readonly persistence: UpdateChannel

  constructor(options: RuntimeUpdateCoalescerOptions) {
    this.ui = this.channel(options.uiFlushMs ?? 25, options.emitUi)
    this.persistence = this.channel(options.persistenceFlushMs ?? 250, options.emitPersistence)
  }

  get pendingCount(): number {
    return this.ui.pending.size + this.persistence.pending.size
  }

  enqueue(update: RuntimeCoalescibleUpdate): void {
    this.enqueueChannel(this.ui, update)
    this.enqueueChannel(this.persistence, update)
  }

  async enqueueCritical(update: RuntimeCoalescibleUpdate): Promise<void> {
    await this.flushSession(update.sessionId)
    await this.write(this.ui, [update])
    await this.write(this.persistence, [update])
  }

  async flushSession(sessionId: string): Promise<void> {
    await this.flushPersistence(sessionId)
  }

  async drain(): Promise<void> {
    await this.flushPersistence()
  }

  close(): void {
    this.clearTimer(this.ui)
    this.clearTimer(this.persistence)
  }

  private channel(flushMs: number, emit: (updates: RuntimeCoalescibleUpdate[]) => Promise<void>): UpdateChannel {
    return { pending: new Map(), flushMs, emit, writeChain: Promise.resolve() }
  }

  private enqueueChannel(channel: UpdateChannel, update: RuntimeCoalescibleUpdate): void {
    const key = runtimeUpdateKey(update)
    channel.pending.set(key, mergeUpdate(channel.pending.get(key), update))
    if (channel.timer) return
    channel.timer = setTimeout(() => {
      channel.timer = undefined
      void (channel === this.persistence
        ? this.flushPersistence()
        : this.flushChannel(channel))
    }, channel.flushMs)
    channel.timer.unref?.()
  }

  private async flushChannel(channel: UpdateChannel, sessionId?: string): Promise<void> {
    const updates = this.takePending(channel, sessionId)
    if (updates.length > 0) await this.write(channel, updates)
    else await channel.writeChain
  }

  private takePending(channel: UpdateChannel, sessionId?: string): RuntimeCoalescibleUpdate[] {
    const updates: RuntimeCoalescibleUpdate[] = []
    for (const [key, update] of channel.pending) {
      if (sessionId && update.sessionId !== sessionId) continue
      channel.pending.delete(key)
      updates.push(update)
    }
    if (channel.pending.size === 0) this.clearTimer(channel)
    return updates
  }

  private async flushPersistence(sessionId?: string): Promise<void> {
    const updates = this.takePending(this.persistence, sessionId)
    await this.flushChannel(this.ui, sessionId)
    if (updates.length > 0) await this.write(this.persistence, updates)
    else await this.persistence.writeChain
  }

  private write(channel: UpdateChannel, updates: RuntimeCoalescibleUpdate[]): Promise<void> {
    channel.writeChain = channel.writeChain.then(() => channel.emit(updates))
    return channel.writeChain
  }

  private clearTimer(channel: UpdateChannel): void {
    if (!channel.timer) return
    clearTimeout(channel.timer)
    channel.timer = undefined
  }
}

export function runtimeUpdateKey(update: RuntimeCoalescibleUpdate): string {
  if (update.kind === 'process-item') return `${update.sessionId}:process:${update.processItemId}`
  if (update.kind === 'session-update') {
    const data = recordField(update, 'data')
    if (typeof update.contentDelta === 'string' || typeof data?.contentDelta === 'string') {
      return `${update.sessionId}:${update.kind}:${update.messageId}:text`
    }
    if (typeof data?.thinking === 'string') return `${update.sessionId}:${update.kind}:${update.messageId}:thinking`
    const toolCall = record(data?.toolCall)
    if (toolCall) return `${update.sessionId}:${update.kind}:${update.messageId}:tool-call:${stringValue(toolCall.id)}`
    const toolCallUpdate = record(data?.toolCallUpdate)
    if (toolCallUpdate) {
      return `${update.sessionId}:${update.kind}:${update.messageId}:tool-update:${stringValue(toolCallUpdate.id)}`
    }
    if (data?.usage !== undefined) return `${update.sessionId}:${update.kind}:${update.messageId}:usage`
    if (data?.configOptions !== undefined) return `${update.sessionId}:${update.kind}:${update.messageId}:config-options`
    if (data?.commands !== undefined) return `${update.sessionId}:${update.kind}:${update.messageId}:commands`
    if (data?.sessionInfo !== undefined) return `${update.sessionId}:${update.kind}:${update.messageId}:session-info`
    if (data?.plan !== undefined) return `${update.sessionId}:${update.kind}:${update.messageId}:plan`
    if (data?.permissionRequest !== undefined) return `${update.sessionId}:${update.kind}:${update.messageId}:permission`
    if (data?.elicitationRequest !== undefined) return `${update.sessionId}:${update.kind}:${update.messageId}:elicitation`
    if (typeof data?.eventType === 'string') {
      return `${update.sessionId}:${update.kind}:${update.messageId}:event:${data.eventType}`
    }
  }
  return `${update.sessionId}:${update.kind}:${update.messageId}`
}

function mergeUpdate(
  current: RuntimeCoalescibleUpdate | undefined,
  incoming: RuntimeCoalescibleUpdate,
): RuntimeCoalescibleUpdate {
  if (!current) return { ...incoming }
  if (current.kind === 'session-update' && incoming.kind === 'session-update') {
    const currentData = recordField(current, 'data')
    const incomingData = recordField(incoming, 'data')
    const mergedData =
      currentData || incomingData
        ? {
            ...currentData,
            ...incomingData,
            ...(typeof currentData?.contentDelta === 'string' || typeof incomingData?.contentDelta === 'string'
              ? { contentDelta: `${stringValue(currentData?.contentDelta)}${stringValue(incomingData?.contentDelta)}` }
              : {}),
            ...(typeof currentData?.thinking === 'string' || typeof incomingData?.thinking === 'string'
              ? { thinking: `${stringValue(currentData?.thinking)}${stringValue(incomingData?.thinking)}` }
              : {}),
          }
        : undefined
    return {
      ...current,
      ...incoming,
      contentDelta: `${current.contentDelta ?? ''}${incoming.contentDelta ?? ''}`,
      ...(mergedData ? { data: mergedData } : {}),
    }
  }
  if (incoming.kind === 'process-item') return { ...incoming }
  return { ...current, ...incoming }
}

function recordField(update: RuntimeCoalescibleUpdate, key: string): Record<string, unknown> | undefined {
  const value = update[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
