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
    await this.flushChannel(this.ui, sessionId)
    await this.flushChannel(this.persistence, sessionId)
  }

  async drain(): Promise<void> {
    await Promise.all([this.flushChannel(this.ui), this.flushChannel(this.persistence)])
  }

  close(): void {
    this.clearTimer(this.ui)
    this.clearTimer(this.persistence)
  }

  private channel(
    flushMs: number,
    emit: (updates: RuntimeCoalescibleUpdate[]) => Promise<void>,
  ): UpdateChannel {
    return { pending: new Map(), flushMs, emit, writeChain: Promise.resolve() }
  }

  private enqueueChannel(channel: UpdateChannel, update: RuntimeCoalescibleUpdate): void {
    const key = updateKey(update)
    channel.pending.set(key, mergeUpdate(channel.pending.get(key), update))
    if (channel.timer) return
    channel.timer = setTimeout(() => {
      channel.timer = undefined
      void this.flushChannel(channel)
    }, channel.flushMs)
    channel.timer.unref?.()
  }

  private async flushChannel(channel: UpdateChannel, sessionId?: string): Promise<void> {
    const updates: RuntimeCoalescibleUpdate[] = []
    for (const [key, update] of channel.pending) {
      if (sessionId && update.sessionId !== sessionId) continue
      channel.pending.delete(key)
      updates.push(update)
    }
    if (channel.pending.size === 0) this.clearTimer(channel)
    if (updates.length > 0) await this.write(channel, updates)
    else await channel.writeChain
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

function updateKey(update: RuntimeCoalescibleUpdate): string {
  if (update.kind === 'process-item') return `${update.sessionId}:process:${update.processItemId}`
  if (update.kind === 'session-update') {
    const data = recordField(update, 'data')
    if (typeof update.contentDelta === 'string' || typeof data?.contentDelta === 'string') {
      return `${update.sessionId}:${update.kind}:${update.messageId}:text`
    }
    if (typeof data?.thinking === 'string') return `${update.sessionId}:${update.kind}:${update.messageId}:thinking`
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
    const mergedData = currentData || incomingData
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
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
