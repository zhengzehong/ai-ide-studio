import { sessionManager } from '../../core/sessions.js'
import { sessionShareStore } from '../../store/session-shares.js'
import type { RpcHandlerMap } from './types.js'

export const subscriptionRpcHandlers: RpcHandlerMap = {
  subscribe(msg, { state, sendResult, sendError }) {
    const ids = (msg.sessionIds as string[]) ?? []
    if (state.authMode === 'guest') {
      const allowedSessionId = state.sessionId
      if (!allowedSessionId) {
        sendError('访客会话未解析,无法订阅')
        return
      }
      const disallowed = ids.filter((id) => id !== allowedSessionId)
      if (disallowed.length > 0) {
        sendError(`访客只能订阅分享对应的会话: ${allowedSessionId}`)
        return
      }
    }
    ids.forEach((id) => state.subscriptions.add(id))
    sendResult({ subscribed: ids })
  },

  unsubscribe(msg, { state, sendResult }) {
    const ids = (msg.sessionIds as string[]) ?? []
    ids.forEach((id) => state.subscriptions.delete(id))
    sendResult({ unsubscribed: ids })
  },

  prompt(msg, { state, sendResult, sendOutOfBandError }) {
    const sessionId = msg.sessionId as string
    const content = msg.content as string
    const clientMessageId = typeof msg.clientMessageId === 'string' ? msg.clientMessageId : undefined
    const contextProjectId = typeof msg.contextProjectId === 'string' ? msg.contextProjectId : undefined
    const images = msg.images as { data: string; mimeType: string }[] | undefined
    state.subscriptions.add(sessionId)
    sendResult({ status: 'streaming' })
    sessionManager.sendPrompt(sessionId, content, images, { clientMessageId, contextProjectId }).catch((err) => {
      sendOutOfBandError(`Prompt 执行失败: ${err instanceof Error ? err.message : err}`)
    })
  },

  async decision(msg) {
    await sessionManager.sendDecision(msg.sessionId as string, msg.messageId as string, msg.choice as string)
  },

  async guest_prompt(msg, { state, sendResult, sendError }) {
    if (state.authMode !== 'guest') {
      sendError('需要访客身份')
      return
    }
    const shareToken = (msg.shareToken as string) ?? state.shareToken
    if (!shareToken) {
      sendError('缺少 shareToken')
      return
    }
    const share = sessionShareStore.getByToken(shareToken)
    if (!share) {
      sendError('分享不存在或已失效')
      return
    }
    if (share.permission !== 'chat') {
      sendError('此分享为只读模式,不能发消息')
      return
    }
    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
      sendError('分享已过期')
      return
    }
    if (state.sessionId && share.session_id !== state.sessionId) {
      sendError('会话不匹配')
      return
    }
    const content = msg.content as string
    if (typeof content !== 'string' || !content.trim()) {
      sendError('消息内容不能为空')
      return
    }
    const guestId = (msg.guestId as string) ?? state.guestId ?? 'guest-anon'
    const guestName = (msg.guestName as string) ?? state.guestName ?? '访客'
    state.subscriptions.add(share.session_id)
    sendResult({ status: 'streaming' })
    sessionManager
      .enqueuePrompt(share.session_id, content, undefined, {
        senderRole: 'guest',
        senderId: guestId,
        senderName: guestName,
      })
      .catch((err) => {
        sendError(`访客消息发送失败: ${err instanceof Error ? err.message : err}`)
      })
  },
}
