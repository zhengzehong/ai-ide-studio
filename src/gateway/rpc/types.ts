import type { ClientMessage } from '../../types/ws-protocol.js'

export type RpcAuthMode = 'owner' | 'guest'

export interface RpcClientState {
  subscriptions: Set<string>
  authMode: RpcAuthMode
  shareToken?: string
  guestId?: string
  guestName?: string
  sessionId?: string
}

export interface RpcContext {
  state: RpcClientState
  sendResult: (data: unknown) => void
  sendError: (message: string) => void
  sendOutOfBandError: (message: string) => void
}

export type RpcHandler = (msg: ClientMessage, context: RpcContext) => void | Promise<void>
export type RpcHandlerMap = Record<string, RpcHandler>
