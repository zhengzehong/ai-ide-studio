import { listPublicTeamConversations } from '../../../core/team-contacts.js'
import type { ToolHandler } from '../../types.js'

export const listTeamConversationsHandler: ToolHandler = {
  name: 'team.conversation.list',
  description: '列出可继续联系的团队会话。外部仅能查询当前会话与团队的联系；无联系时用 agent.message.send(targetTeamId) 发起。返回 sessionId 可继续发送消息，不授权读取内部历史。',
  inputSchema: { type: 'object', properties: { teamId: { type: 'string' } }, required: ['teamId'] },
  async execute(input, context) {
    if (typeof input.teamId !== 'string' || !input.teamId.trim()) throw new Error('teamId 不能为空')
    return { content: [{ type: 'text', text: JSON.stringify({ conversations: listPublicTeamConversations(context, input.teamId) }) }] }
  },
}
