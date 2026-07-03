import type { CreateToolInput } from '../store/tools.js'

const AGENT_HUB_PERMISSIONS = { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: true }

export const AGENT_HUB_BUILTIN_TOOLS: (CreateToolInput & { defaultScope: 'global' })[] = [
  {
    name: 'agent_hub.connect',
    displayName: '连接 A2A Hub',
    description: '连接到 A2A Hub,注册当前会话,可被其他机器的 Agent 调用。零参数,平台自动配置。重复调用幂等,返回当前可见 Agent 列表。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'agent_hub.connect' },
    inputSchema: {
      type: 'object',
      properties: {},
    },
    permissions: AGENT_HUB_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'agent_hub.disconnect',
    displayName: '断开 A2A Hub',
    description: '断开与 A2A Hub 的连接,清理 Hub 注册和 SSE 长连接。未连接时返回 not_connected,幂等不报错。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'agent_hub.disconnect' },
    inputSchema: {
      type: 'object',
      properties: {},
    },
    permissions: AGENT_HUB_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'agent_hub.list',
    displayName: '列出 Hub Agent',
    description: '列出 A2A Hub 上可发现的其他 Agent。可选 scopeKeys / match 过滤,默认用内置 scopeKeys。',
    category: 'data',
    type: 'builtin',
    config: { handler: 'agent_hub.list' },
    inputSchema: {
      type: 'object',
      properties: {
        scopeKeys: { type: 'array', items: { type: 'string' }, description: '可选 scopeKeys 过滤' },
        match: { type: 'string', enum: ['any', 'all'], description: '匹配模式,默认 any' },
      },
    },
    permissions: AGENT_HUB_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
  {
    name: 'agent_hub.send',
    displayName: '发送 Hub 消息',
    description: '向 A2A Hub 上的另一个 Agent 发消息(异步)。Hub 返回 hubTaskId 后立即返回,对方处理完成后结果会自动注入当前会话,无需轮询。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'agent_hub.send' },
    inputSchema: {
      type: 'object',
      properties: {
        targetHubAgentId: { type: 'string', description: '目标 Agent 在 Hub 上的 ID' },
        message: { type: 'string', description: '消息内容' },
        contextId: { type: 'string', description: '可选 contextId,多轮对话复用' },
      },
      required: ['targetHubAgentId', 'message'],
    },
    permissions: AGENT_HUB_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
]
