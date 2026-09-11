import { listMobileConversationCatalog } from '../../core/mobile-conversations.js'
import { sessionManager } from '../../core/sessions.js'
import type { RpcHandlerMap } from './types.js'

export const mobileConversationRpcHandlers: RpcHandlerMap = {
  'mobile.conversations.list'(msg, { state, sendResult }) {
    if (state.authMode !== 'owner') throw new Error('访客无权访问项目会话列表')
    sendResult(listMobileConversationCatalog(
      typeof msg.projectId === 'string' ? msg.projectId : undefined,
      id => sessionManager.isPromptActive(id),
    ))
  },
}
