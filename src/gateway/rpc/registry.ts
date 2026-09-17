import type { ClientMessage } from '../../types/ws-protocol.js'
import { agentRpcHandlers } from './agents.js'
import { assetRpcHandlers } from './assets.js'
import { autonomyRpcHandlers } from './autonomy.js'
import { filesystemRpcHandlers } from './filesystem.js'
import { globalAssistantRpcHandlers } from './global-assistant.js'
import { agentMemoryRpcHandlers } from './agent-memory.js'
import { eventCenterRpcHandlers } from './event-center.js'
import { knowledgeBaseRpcHandlers } from './knowledge-base.js'
import { modelRpcHandlers } from './models.js'
import { modelCaptureRpcHandlers } from './model-capture.js'
import { projectRpcHandlers } from './projects.js'
import { ruleRpcHandlers } from './rules.js'
import { sessionRpcHandlers } from './sessions.js'
import { sessionRecoveryRpcHandlers } from './session-recovery.js'
import { sessionDockRpcHandlers } from './session-dock.js'
import { sessionStatsRpcHandlers } from './session-stats.js'
import { sessionTemplateRpcHandlers } from './session-templates.js'
import { skillRpcHandlers } from './skills.js'
import { subscriptionRpcHandlers } from './subscriptions.js'
import { taskRpcHandlers } from './tasks.js'
import { templateRpcHandlers } from './templates.js'
import { teamRpcHandlers } from './teams.js'
import { mobileConversationRpcHandlers } from './mobile-conversations.js'
import { toolRpcHandlers } from './tools.js'
import { timelineRpcHandlers } from './timeline.js'
import { widgetRpcHandlers } from './widget.js'
import { previewRpcHandlers } from './previews.js'
import { secretaryRpcHandlers } from './secretary.js'
import { inspirationRpcHandlers } from './inspiration.js'
import { advisorRpcHandlers } from './advisor.js'
import { spreadsheetRpcHandlers } from './spreadsheets.js'
import { readingRpcHandlers } from './readings.js'
import type { RpcContext, RpcHandlerMap } from './types.js'
import { trackAsyncOperation, trackInvocation } from '../../shared/operation-diagnostics.js'

const rpcHandlers: RpcHandlerMap = {
  ...subscriptionRpcHandlers,
  ...autonomyRpcHandlers,
  ...eventCenterRpcHandlers,
  ...agentMemoryRpcHandlers,
  ...knowledgeBaseRpcHandlers,
  ...globalAssistantRpcHandlers,
  ...sessionRpcHandlers,
  ...sessionRecoveryRpcHandlers,
  ...sessionDockRpcHandlers,
  ...sessionStatsRpcHandlers,
  ...sessionTemplateRpcHandlers,
  ...agentRpcHandlers,
  ...assetRpcHandlers,
  ...taskRpcHandlers,
  ...ruleRpcHandlers,
  ...projectRpcHandlers,
  ...templateRpcHandlers,
  ...teamRpcHandlers,
  ...mobileConversationRpcHandlers,
  ...toolRpcHandlers,
  ...filesystemRpcHandlers,
  ...modelRpcHandlers,
  ...skillRpcHandlers,
  ...timelineRpcHandlers,
  ...widgetRpcHandlers,
  ...previewRpcHandlers,
  ...secretaryRpcHandlers,
  ...inspirationRpcHandlers,
  ...advisorRpcHandlers,
  ...spreadsheetRpcHandlers,
  ...readingRpcHandlers,
  ...modelCaptureRpcHandlers,
}

export async function dispatchRpc(msg: ClientMessage, context: RpcContext): Promise<void> {
  const handler = rpcHandlers[msg.type]
  if (!handler) {
    context.sendError(`未知消息类型: ${msg.type}`)
    return
  }
  const operationContext = {
    rpcType: msg.type,
    requestId: msg.requestId,
    sessionId: textField(msg, 'sessionId'),
  }
  await trackAsyncOperation(
    { operationModule: 'gateway:rpc', operation: 'dispatch', context: operationContext },
    async () => {
      // trackInvocation:handler 可能是同步的,也可能返回 Promise(fs.list 已异步化)。
      // 用 trackSyncInvocation 包 async handler 只会量到同步前缀 ≈0ms,
      // 让 recentSyncOperations 里再也看不到这个操作 —— 这正是 P0-1 要避免的可观测性回归。
      const result = trackInvocation(
        { operationModule: 'gateway:rpc', operation: 'handler.invoke', context: operationContext },
        () => handler(msg, context),
      )
      await result
    },
  )
}

function textField(message: ClientMessage, field: string): string | undefined {
  const value = message[field]
  return typeof value === 'string' ? value : undefined
}
