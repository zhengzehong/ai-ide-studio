import type { ClientMessage } from '../../types/ws-protocol.js'

export interface RpcClientState {
  subscriptions: Set<string>
}

export interface RpcContext {
  state: RpcClientState
  sendResult: (data: unknown) => void
  sendError: (message: string) => void
  sendOutOfBandError: (message: string) => void
}

export type RpcHandler = (msg: ClientMessage, context: RpcContext) => void | Promise<void>
export type RpcHandlerMap = Record<string, RpcHandler>
