import { wsClient } from './ws-client'

export async function wsRpc(type: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return wsClient.request({ type, ...params })
}
