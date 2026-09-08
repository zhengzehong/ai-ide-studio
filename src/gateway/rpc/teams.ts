import { teamService } from '../../core/teams.js'
import type { RpcHandlerMap } from './types.js'

export const teamRpcHandlers: RpcHandlerMap = {
  'teams.defaults'(_msg, { sendResult }) {
    sendResult({ masterPrompt: teamService.describeTemplate('tpl-team-leader').system_prompt })
  },
  'teams.create'(msg, { sendResult }) {
    sendResult(teamService.create({
      projectId: requiredText(msg.projectId, 'projectId'),
      name: requiredText(msg.name, 'name'),
      description: typeof msg.description === 'string' ? msg.description : undefined,
      masterPrompt: typeof msg.masterPrompt === 'string' ? msg.masterPrompt : undefined,
    }))
  },
  'teams.list'(msg, { sendResult }) {
    const projectId = typeof msg.projectId === 'string' ? msg.projectId : undefined
    sendResult(teamService.list(projectId))
  },
  'teams.detail'(msg, { sendResult }) {
    const teamId = requiredText(msg.teamId, 'teamId')
    sendResult(teamService.detail(teamId))
  },
  'team.conversation.list'(msg, { sendResult }) {
    sendResult(teamService.listConversations(requiredText(msg.teamId, 'teamId')))
  },
  'team.conversation.create'(msg, { sendResult }) {
    sendResult(teamService.createConversation(requiredText(msg.teamId, 'teamId'), typeof msg.title === 'string' ? msg.title : undefined))
  },
  'team.conversation.history'(msg, { sendResult }) {
    sendResult(teamService.conversationDetail(requiredText(msg.conversationId, 'conversationId')))
  },
  'team.conversation.rename'(msg, { sendResult }) {
    sendResult(teamService.renameConversation(requiredText(msg.conversationId, 'conversationId'), requiredText(msg.title, 'title')))
  },
  'team.conversation.archive'(msg, { sendResult }) {
    sendResult(teamService.archiveConversation(requiredText(msg.conversationId, 'conversationId')))
  },
  'team.conversation.delete'(msg, { sendResult }) {
    sendResult(teamService.deleteConversation(requiredText(msg.conversationId, 'conversationId')))
  },
  'teams.current'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string | undefined
    if (!sessionId) throw new Error('sessionId 不能为空')
    sendResult(teamService.currentBySession(sessionId))
  },
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field} 不能为空`)
  return value.trim()
}
