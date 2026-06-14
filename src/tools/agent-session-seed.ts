import type { CreateToolInput } from '../store/tools.js'

const AGENT_SESSION_PERMISSIONS = { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false }

export const AGENT_SESSION_BUILTIN_TOOLS: (CreateToolInput & { defaultScope: 'global' })[] = [
  {
    name: 'agent.message.send',
    displayName: '发送 Agent 消息',
    description: '向另一个 Agent 会话发送消息；只传 targetAgentId 时会创建新会话。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'agent.message.send' },
    inputSchema: {
      type: 'object',
      properties: {
        targetAgentId: { type: 'string', description: '目标 Agent ID；不传 targetSessionId 时必填' },
        targetSessionId: { type: 'string', description: '目标会话 ID' },
        content: { type: 'string', description: '消息内容' },
        relatedInfo: { type: 'object', description: '动态关联信息 JSON' },
        needReply: { type: 'boolean', description: '是否要求目标 Agent 完成后回复' },
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
