import {
  runtimeUpdateKey,
  type RuntimeCoalescibleUpdate,
} from './runtime-update-coalescer.js'

export interface RuntimeStreamCursor {
  streamGeneration: string
  sequence: number
}

export interface RuntimePersistenceBinding {
  update: RuntimeCoalescibleUpdate
  key: string
  cursor: RuntimeStreamCursor
}

export class RuntimeUpdateCursorStore {
  private readonly cursors = new Map<string, RuntimeStreamCursor>()

  assign(update: RuntimeCoalescibleUpdate, cursor: RuntimeStreamCursor): void {
    this.cursors.set(runtimeUpdateKey(update), cursor)
  }

  capturePersistenceBatch(updates: RuntimeCoalescibleUpdate[]): RuntimePersistenceBinding[] {
    return updates.map((update) => {
      const key = runtimeUpdateKey(update)
      const cursor = this.cursors.get(key)
      if (!cursor) throw new Error(`Runtime persistence update has no UI cursor: ${key}`)
      return { update, key, cursor }
    })
  }

  release(binding: RuntimePersistenceBinding): void {
    if (this.cursors.get(binding.key) === binding.cursor) this.cursors.delete(binding.key)
  }
}
