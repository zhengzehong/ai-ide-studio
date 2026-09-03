import type { CreateToolInput } from '../store/tools.js'

const ADVISOR_TOOL_PERMISSIONS = { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false }

export const ADVISOR_BUILTIN_TOOLS: (CreateToolInput & { defaultScope: 'global' })[] = [
  {
    name: 'suggestion.present',
    displayName: '提交参谋建议',
    description: '提交本轮参谋建议（每轮最多 3 条，可传空数组表示无货沉默并填 noFindingReason）。同一轮重复调用以最后一次为准；禁止测试或占位内容。plan 类型建议必须同时提交 artifactName 和 artifactHtml（完整可打开的 HTML 方案文档），action 类型说明本身就是执行包。',
    category: 'automation',
    type: 'builtin',
    config: { handler: 'suggestion.present' },
    inputSchema: {
      type: 'object',
      properties: {
        roundId: { type: 'string', description: '提示中提供的轮次 ID' },
        noFindingReason: { type: 'string', description: 'suggestions 为空时必填：为什么本轮没有值得建议的内容' },
        suggestions: {
          type: 'array',
          maxItems: 3,
          description: '本轮建议列表，最多 3 条；没有值得说的传 [] 并填 noFindingReason',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['plan', 'action'], description: 'plan=附完整 HTML 方案文档（需用户打开看再决策）；action=说明即执行包，可直接执行' },
              title: { type: 'string', description: '建议标题（即任务标题，≤160 字符）' },
              descriptionMarkdown: { type: 'string', description: '预填执行包：背景/目标/交付物/验收标准，至少 80 个字符' },
              suggestedAgentId: { type: 'string', description: '当前项目内推荐执行 Agent ID' },
              agentReason: { type: 'string', description: '推荐该 Agent 的理由' },
              sourceEvidence: {
                type: 'array',
                maxItems: 5,
                description: '来源佐证会话（至少 1 条），用于建议卡片跳转',
                items: {
                  type: 'object',
                  properties: {
                    sessionId: { type: 'string', description: '佐证会话 ID' },
                    title: { type: 'string', description: '佐证会话标题' },
                  },
                  required: ['sessionId', 'title'],
                },
              },
              artifactName: { type: 'string', description: 'plan 类型必填：方案文档文件名，如 阈值重构方案.html' },
              artifactHtml: { type: 'string', description: 'plan 类型必填：完整可打开的 HTML 方案文档内容' },
            },
            required: ['type', 'title', 'descriptionMarkdown', 'sourceEvidence'],
          },
        },
      },
      required: ['roundId', 'suggestions'],
    },
    permissions: ADVISOR_TOOL_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  },
]
