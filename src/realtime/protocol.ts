import type { ClientMessage, ServerMessage } from '../types/ws-protocol.js'

export type RealtimeAuthMode = 'owner' | 'guest'

export interface RealtimeConnectionClaims {
  authMode: RealtimeAuthMode
  shareToken?: string
  guestId?: string
  guestName?: string
  sessionId?: string
  toolCallVisibility?: 'show' | 'hide'
}

export type RealtimeDelivery =
  | { scope: 'all'; message: ServerMessage }
  | { scope: 'session'; sessionId: string; message: ServerMessage }

export interface RealtimeRpcState extends RealtimeConnectionClaims {
  subscriptions: string[]
}

export type RealtimeIpcPayload =
  | { type: 'hello'; token: string }
  | { type: 'ready'; port: number }
  | { type: 'auth.request'; connectionId: string; token?: string; shareToken?: string; guestId?: string; guestName?: string }
  | { type: 'auth.result'; connectionId: string; claims?: RealtimeConnectionClaims; error?: string }
  | { type: 'event'; delivery: RealtimeDelivery }
  | { type: 'rpc.request'; bridgeRequestId: string; connectionId: string; message: ClientMessage; state: RealtimeRpcState }
  | { type: 'rpc.frame'; bridgeRequestId: string; connectionId: string; message: ServerMessage }
  | { type: 'rpc.complete'; bridgeRequestId: string; connectionId: string; subscriptions: string[] }
  | { type: 'control'; operation: 'drain' | 'stop' }
  | { type: 'control.ack'; operation: 'drain' | 'stop' }

export function isRealtimeIpcPayload(value: unknown): value is RealtimeIpcPayload {
  return isRecord(value) && typeof value.type === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
