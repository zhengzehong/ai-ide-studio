import type { CreateToolInput } from '../store/tools.js'

const AGENT_SESSION_PERMISSIONS = { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false }

export const AGENT_SESSION_BUILTIN_TOOLS: (CreateToolInput & { defaultScope: 'global' })[] = [
  {
    name: 'agent.message.send',
    displayName: '发送 Agent 消息',
    description: '向另一个 Agent 会话发送消息。异步投递，调用后立即返回，不要等待目标 Agent 完成。\n\ntargetSessionId 建议:\n- 回复对方消息时:填对方系统消息里的"来源会话 ID",确保回复进原上下文\n- 主动发起对话时:填对方 primary 会话 ID(可用 agent.session.list 查)\n- 仅首次联系对方、对方没有任何活跃会话时,才只传 targetAgentId 新建会话\n- 已有活跃会话但只传 targetAgentId,会新建空壳会话,对方很可能看不到\n\n如果 needReply=true,发送后结束当前轮;目标 Agent 回传后系统会自动唤醒来源会话。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'agent.message.send' },
    inputSchema: {
      type: 'object',
      properties: {
        targetAgentId: { type: 'string', description: '目标 Agent ID。通常和 targetSessionId 一起传;仅在首次联系对方且无活跃会话时单独传,会新建会话' },
        targetSessionId: { type: 'string', description: '目标会话 ID。回复对方消息时填对方系统消息里的"来源会话 ID";主动发起对话时填对方 primary 会话 ID。除非是首次联系对方且无活跃会话,否则建议总是传入,避免消息落到空壳会话' },
        content: { type: 'string', description: '消息内容' },
        relatedInfo: { type: 'object', description: '动态关联信息 JSON' },
        needReply: { type: 'boolean', description: '是否要求目标 Agent 完成后回复；系统会在收到回复后自动唤醒来源会话' },
      },
      required: ['content'],
    },
    permissions: AGENT_SESSION_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'agent.session.list',
    displayName: '查看 Agent 会话',
    description: '查看某个 Agent 在当前项目内的会话列表。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'agent.session.list' },
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
        limit: { type: 'number', description: '返回数量，默认 20' },
      },
      required: ['agentId'],
    },
    permissions: AGENT_SESSION_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'agent.session.messages',
    displayName: '查看会话消息',
    description: '查看某个会话的最近消息。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'agent.session.messages' },
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '会话 ID' },
        limit: { type: 'number', description: '返回数量，默认 10' },
      },
      required: ['sessionId'],
    },
    permissions: AGENT_SESSION_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'agent.watch.create',
    displayName: '创建会话监听',
    description: '监听另一个会话的下一次完成事件；once 默认 true。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'agent.watch.create' },
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '被监听会话 ID' },
        once: { type: 'boolean', description: '是否只触发一次，默认 true' },
        relatedInfo: { type: 'object', description: '动态关联信息 JSON' },
      },
      required: ['sessionId'],
    },
    permissions: AGENT_SESSION_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'agent.watch.cancel',
    displayName: '取消会话监听',
    description: '取消当前会话创建的 watch。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'agent.watch.cancel' },
    inputSchema: {
      type: 'object',
      properties: { watchId: { type: 'string', description: 'Watch ID' } },
      required: ['watchId'],
    },
    permissions: AGENT_SESSION_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
]
