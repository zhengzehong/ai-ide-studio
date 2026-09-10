import { teamMemberStore, teamStore } from '../store/teams.js'
import { teamIdentityTransitionStore } from '../store/team-identity-transition.js'

export function buildTeamRuntimePrompt(sessionId?: string): string {
  if (!sessionId) return ''
  const member = teamMemberStore.getBySession(sessionId)
  if (!member) return ''
  const team = teamStore.get(member.team_id)
  if (!team) return ''
  const previous = teamIdentityTransitionStore.previousSession(sessionId)
  return [
    '## 团队身份与通信',
    `你在团队「${team.name}」中，团队 ID: ${team.id}；成员 ID: ${member.id}。`,
    member.role === 'leader'
      ? '你是 Master，对外代表团队。用 team.list 查找团队，team.conversation.list 查已有联系；首次联系团队用 agent.message.send(targetTeamId)，回复用来源 targetSessionId。成员内部通过 team.member.message 派发、mailbox 接收汇报。'
      : '你是内部成员。使用 team.mailbox.send 向 Master 汇报或提出外部协作需求，不直接联系其他 Agent 或团队，不创建独立的团队成员会话。',
    previous ? `本会话已切换到团队专属身份。此前工作会话: ${previous}。先查看 team.task.list 和 mailbox 确认进度；需要细节时可用 agent.session.messages 阅读该历史会话，不要向旧会话发消息。历史私人记忆没有复制。` : '',
  ].filter(Boolean).join('\n')
}
