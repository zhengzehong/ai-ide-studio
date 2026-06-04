import type { ClientMessage } from '../../types/ws-protocol.js'
import { agentRpcHandlers } from './agents.js'
import { filesystemRpcHandlers } from './filesystem.js'
import { modelRpcHandlers } from './models.js'
import { projectRpcHandlers } from './projects.js'
import { ruleRpcHandlers } from './rules.js'
import { sessionRpcHandlers } from './sessions.js'
import { skillRpcHandlers } from './skills.js'
import { subscriptionRpcHandlers } from './subscriptions.js'
import { taskRpcHandlers } from './tasks.js'
import { templateRpcHandlers } from './templates.js'
import { teamRpcHandlers } from './teams.js'
import { toolRpcHandlers } from './tools.js'
import { timelineRpcHandlers } from './timeline.js'
import type { RpcContext, RpcHandlerMap } from './types.js'

const rpcHandlers: RpcHandlerMap = {
  ...subscriptionRpcHandlers,
  ...sessionRpcHandlers,
  ...agentRpcHandlers,
  ...taskRpcHandlers,
  ...ruleRpcHandlers,
  ...projectRpcHandlers,
  ...templateRpcHandlers,
  ...teamRpcHandlers,
  ...toolRpcHandlers,
  ...filesystemRpcHandlers,
  ...modelRpcHandlers,
  ...skillRpcHandlers,
  ...timelineRpcHandlers,
}

export async function dispatchRpc(msg: ClientMessage, context: RpcContext): Promise<void> {
  const handler = rpcHandlers[msg.type]
  if (!handler) {
    context.sendError(`未知消息类型: ${msg.type}`)
    return
  }
  await handler(msg, context)
}
