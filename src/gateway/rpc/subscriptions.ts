import { events } from '../../core/events.js'
import { sessionManager } from '../../core/sessions.js'
import type { RpcHandlerMap } from './types.js'

export const subscriptionRpcHandlers: RpcHandlerMap = {
  subscribe(msg, { state, sendResult }) {
    const ids = msg.sessionIds as string[]
    ids.forEach((id) => state.subscriptions.add(id))
    sendResult({ subscribed: ids })
  },

  unsubscribe(msg, { state, sendResult }) {
    const ids = msg.sessionIds as string[]
    ids.forEach((id) => state.subscriptions.delete(id))
    sendResult({ unsubscribed: ids })
  },

  prompt(msg, { state, sendResult, sendOutOfBandError }) {
    const sessionId = msg.sessionId as string
    const content = msg.content as string
    const images = msg.images as { data: string; mimeType: string }[] | undefined
    state.subscriptions.add(sessionId)
    sendResult({ status: 'streaming' })
    sessionManager.sendPrompt(sessionId, content, images).catch((err) => {
      sendOutOfBandError(`Prompt 执行失败: ${err instanceof Error ? err.message : err}`)
    })
  },

  async decision(msg) {
    await sessionManager.sendDecision(msg.sessionId as string, msg.messageId as string, msg.choice as string)
  },
}

export function emitSessionEvent(sessionId: string, agentId: string | null | undefined, event: unknown): void {
  events.emit('session:event', { sessionId, agentId, event: event as never })
}
