import type { ClientMessage, ServerMessage } from '../types/ws-protocol.js'
import type { RealtimeLegacyRpcRequest } from '../realtime/process-client.js'
import { dispatchRpc } from './rpc/registry.js'
import type { RpcContext } from './rpc/types.js'

export type RpcDispatcher = (message: ClientMessage, context: RpcContext) => Promise<void>
export type RealtimeRpcBridge = (request: RealtimeLegacyRpcRequest) => Promise<readonly string[]>

export function createRealtimeRpcBridge(
  dispatcher: RpcDispatcher = dispatchRpc,
): RealtimeRpcBridge {
  return async (request) => {
    const state = {
      authMode: request.state.authMode,
      shareToken: request.state.shareToken,
      guestId: request.state.guestId,
      guestName: request.state.guestName,
      sessionId: request.state.sessionId,
      subscriptions: new Set(request.state.subscriptions),
    }
    const emit = (message: ServerMessage): void => request.emit(message)
    await dispatcher(request.message, {
      state,
      sendResult: (data) => emit({ type: 'result', requestId: request.message.requestId, data }),
      sendError: (message) => emit({ type: 'error', requestId: request.message.requestId, message }),
      sendOutOfBandError: (message) => emit({ type: 'error', message }),
    })
    return [...state.subscriptions]
  }
}
