import { teamService } from '../../core/teams.js'
import { sessionManager } from '../../core/sessions.js'
import type { RpcHandlerMap } from './types.js'
import { modelProfileStore } from '../../store/model-profiles.js'
import { getGlobalModelProfile } from '../../acp/runtime-global-model-profile.js'
import { markTeamConversationRead } from '../../core/team-conversation-read.js'

export const teamRpcHandlers: RpcHandlerMap = {
  'teams.defaults'(_msg, { sendResult }) {
    const profiles = modelProfileStore.list({ runtime: 'claude', enabledOnly: true }).map((profile) => ({
      id: profile.id,
      name: profile.name,
      providerId: profile.provider_id,
      isDefault: profile.is_default === 1,
    }))
    const global = getGlobalModelProfile('claude')
    sendResult({
      masterPrompt: teamService.describeTemplate('tpl-team-leader').system_prompt,
      modelProfiles: profiles,
      defaultModelProfileId: profiles.find((profile) => profile.isDefault)?.id || profiles[0]?.id || null,
      globalModelProfileId: global.enabled ? global.profileId || null : null,
    })
  },
  'teams.create'(msg, { sendResult }) {
    sendResult(teamService.create({
      projectId: requiredText(msg.projectId, 'projectId'),
      name: requiredText(msg.name, 'name'),
      description: typeof msg.description === 'string' ? msg.description : undefined,
      masterPrompt: typeof msg.masterPrompt === 'string' ? msg.masterPrompt : undefined,
      modelProfileId: typeof msg.modelProfileId === 'string' ? msg.modelProfileId : undefined,
    }))
  },
  'teams.list'(msg, { sendResult }) {
    const projectId = typeof msg.projectId === 'string' ? msg.projectId : undefined
    sendResult(teamService.list(projectId))
  },
  'teams.update'(msg, { sendResult }) {
    sendResult(teamService.update(requiredText(msg.teamId, 'teamId'), {
      name: typeof msg.name === 'string' && msg.name.trim() ? msg.name.trim() : undefined,
      description: typeof msg.description === 'string' ? msg.description : undefined,
      masterPrompt: typeof msg.masterPrompt === 'string' ? msg.masterPrompt : undefined,
    }))
  },
  'teams.archive'(msg, { sendResult }) {
    sendResult(teamService.archive(requiredText(msg.teamId, 'teamId')))
  },
  'teams.detail'(msg, { sendResult }) {
    const teamId = requiredText(msg.teamId, 'teamId')
    sendResult(teamService.detail(teamId))
  },
  'team.conversation.list'(msg, { sendResult }) {
    sendResult(teamService.listConversations(
      requiredText(msg.teamId, 'teamId'),
      (sessionId) => sessionManager.isPromptActive(sessionId),
    ))
  },
  'team.conversation.create'(msg, { sendResult }) {
    sendResult(teamService.createConversation(requiredText(msg.teamId, 'teamId'), typeof msg.title === 'string' ? msg.title : undefined))
  },
  'team.conversation.history'(msg, { sendResult }) {
    sendResult(teamService.conversationDetail(requiredText(msg.conversationId, 'conversationId')))
  },
  'team.conversation.markRead'(msg, { sendResult }) {
    sendResult(markTeamConversationRead(requiredText(msg.conversationId, 'conversationId'), msg.messages))
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
