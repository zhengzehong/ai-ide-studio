import { createChildLogger } from '../../shared/logger.js'

const log = createChildLogger('runtime-interaction-state')

export interface PendingInteraction<T> {
  resolve: (value: T) => void
  timer: NodeJS.Timeout
  onCancel: () => void
}

export function waitForInteraction<T>(
  map: Map<string, PendingInteraction<T>>,
  key: string,
  fallback: T,
  onCancel: () => void,
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const pending = map.get(key)
      if (!pending) return
      map.delete(key)
      cancelInteraction(key, pending, fallback)
    }, 10 * 60 * 1000)
    map.set(key, { resolve, timer, onCancel })
  })
}

export function takeInteraction<T>(
  map: Map<string, PendingInteraction<T>>,
  key: string,
): PendingInteraction<T> | undefined {
  const pending = map.get(key)
  if (!pending) return undefined
  clearTimeout(pending.timer)
  map.delete(key)
  return pending
}

export function resolveMatchingInteractions<T>(
  interactions: Map<string, PendingInteraction<T>>,
  prefix: string,
  fallback: T,
): void {
  for (const [key, pending] of interactions) {
    if (!key.startsWith(prefix)) continue
    interactions.delete(key)
    cancelInteraction(key, pending, fallback)
  }
}

export function resolveAllInteractions<T>(
  interactions: Map<string, PendingInteraction<T>>,
  fallback: T,
): void {
  for (const [key, pending] of interactions) cancelInteraction(key, pending, fallback)
  interactions.clear()
}

function cancelInteraction<T>(key: string, pending: PendingInteraction<T>, fallback: T): void {
  clearTimeout(pending.timer)
  try {
    pending.onCancel()
  } catch (err) {
    log.warn({ err, interactionKey: key }, 'failed to publish cancelled interaction result')
  }
  pending.resolve(fallback)
}
