const handlers = new Map<string, Set<(event: Record<string, unknown>) => void>>()
export const requests: Record<string, unknown>[] = []
export function emit(name: string, event: Record<string, unknown>): void {
  handlers.get(name)?.forEach((handler) => handler(event))
}
export const wsClient = {
  request: async (request: Record<string, unknown>): Promise<unknown> => { requests.push(request); return [] },
  on: (name: string, handler: (event: Record<string, unknown>) => void): (() => void) => {
    if (!handlers.has(name)) handlers.set(name, new Set())
    handlers.get(name)!.add(handler)
    return () => { handlers.get(name)?.delete(handler) }
  },
  subscribe: (): void => undefined,
  unsubscribe: (): void => undefined,
  send: (): void => undefined,
}
