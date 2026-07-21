export interface QueueEnqueueOptions {
  now?: number
  deadlineAt?: number
}

export interface QueuedItem<TValue, TPriority extends string> {
  id: number
  value: TValue
  priority: TPriority
  enqueuedAt: number
  deadlineAt?: number
  queueWaitMs: number
  expired: boolean
}

interface InternalQueuedItem<TValue, TPriority extends string> {
  id: number
  value: TValue
  priority: TPriority
  enqueuedAt: number
  deadlineAt?: number
}

export class StablePriorityQueue<TValue = string, TPriority extends string = string> {
  private readonly priorities: readonly TPriority[]
  private readonly priorityIndexes: ReadonlyMap<TPriority, number>
  private readonly items: InternalQueuedItem<TValue, TPriority>[] = []
  private nextId = 1

  constructor(priorities: readonly TPriority[]) {
    if (priorities.length === 0) throw new Error('Queue requires at least one priority')
    if (new Set(priorities).size !== priorities.length) {
      throw new Error('Queue priorities must be unique')
    }
    this.priorities = [...priorities]
    this.priorityIndexes = new Map(priorities.map((priority, index) => [priority, index]))
  }

  get size(): number {
    return this.items.length
  }

  enqueue(
    value: TValue,
    priority: TPriority,
    options: QueueEnqueueOptions = {},
  ): InternalQueuedItem<TValue, TPriority> {
    this.assertPriority(priority)
    const item: InternalQueuedItem<TValue, TPriority> = {
      id: this.nextId,
      value,
      priority,
      enqueuedAt: options.now ?? Date.now(),
      deadlineAt: options.deadlineAt,
    }
    this.nextId += 1
    this.items.push(item)
    return item
  }

  dequeue(now = Date.now()): QueuedItem<TValue, TPriority> | undefined {
    if (this.items.length === 0) return undefined
    let selectedIndex = 0
    let selectedPriority = this.priorityIndex(this.items[0].priority)
    for (let index = 1; index < this.items.length; index += 1) {
      const candidatePriority = this.priorityIndex(this.items[index].priority)
      if (candidatePriority < selectedPriority) {
        selectedIndex = index
        selectedPriority = candidatePriority
      }
    }
    const [item] = this.items.splice(selectedIndex, 1)
    return this.toDequeuedItem(item, now)
  }

  remove(id: number, now = Date.now()): QueuedItem<TValue, TPriority> | undefined {
    const index = this.items.findIndex((item) => item.id === id)
    if (index < 0) return undefined
    const [item] = this.items.splice(index, 1)
    return this.toDequeuedItem(item, now)
  }

  drain(now = Date.now()): QueuedItem<TValue, TPriority>[] {
    const drained: QueuedItem<TValue, TPriority>[] = []
    while (this.items.length > 0) {
      const item = this.dequeue(now)
      if (item) drained.push(item)
    }
    return drained
  }

  private assertPriority(priority: TPriority): void {
    if (!this.priorityIndexes.has(priority)) {
      throw new Error(`Unknown queue priority: ${priority}`)
    }
  }

  private priorityIndex(priority: TPriority): number {
    return this.priorityIndexes.get(priority) ?? this.priorities.length
  }

  private toDequeuedItem(
    item: InternalQueuedItem<TValue, TPriority>,
    now: number,
  ): QueuedItem<TValue, TPriority> {
    return {
      ...item,
      queueWaitMs: Math.max(0, now - item.enqueuedAt),
      expired: item.deadlineAt != null && now > item.deadlineAt,
    }
  }
}
