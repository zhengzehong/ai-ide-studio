import { assertAgentAccess, assertSessionAccess, assertTeamMemberAccess, contextMember, agentAccessScope, isTeamInternalAgent } from '../core/team-access.js'
import { agentStore } from '../store/agents.js'
import { taskStore } from '../store/tasks.js'
import { assertTaskAccess } from '../core/team-task-access.js'
import { teamMemberStore } from '../store/teams.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from './types.js'

const PUBLIC_TEAM_TOOLS = new Set(['team.list', 'team.conversation.list', 'team.template.list', 'team.template.describe'])
const MEMBER_WRITES = new Set(['team.mailbox.send', 'team.task.update'])

export async function executeWithTeamBoundary(handler: ToolHandler, input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
  if (!/^(team\.|core\.(agent|session|task)\.|agent\.(session|message|task)\.|studio\.(task|schedule)\.|create_task$|create_schedule$)/.test(handler.name)) {
    return handler.execute(input, context)
  }
  const member = contextMember(context)
  const trustedContext = { ...context, teamId: member?.team_id, teamMemberId: member?.id }
  assertToolTeamBoundary(handler.name, input, trustedContext)
  return agentAccessScope.run(trustedContext, () => handler.execute(input, trustedContext))
}

export function assertToolTeamBoundary(name: string, input: ToolHandlerInput, context: ToolContext): void {
  if (name.startsWith('team.') && !PUBLIC_TEAM_TOOLS.has(name) && name !== 'team.create') {
    const teamId = typeof input.teamId === 'string' ? input.teamId : context.teamId
    if (!teamId) throw new Error('缺少团队上下文')
    const write = !name.endsWith('.list') && name !== 'team.get'
    assertTeamMemberAccess(context, teamId, write && !MEMBER_WRITES.has(name))
  }
  if (name === 'team.create' && contextMember(context) && contextMember(context)?.role !== 'leader') throw new Error('团队成员不能创建其他团队')
  if (name.startsWith('core.agent.') || name === 'agent.session.list') {
    if (typeof input.agentId === 'string') assertAgentAccess(context, input.agentId)
  }
  if (name.startsWith('core.session.') || name.startsWith('agent.session.')) {
    if (typeof input.sessionId === 'string') assertSessionAccess(context, input.sessionId)
    if (typeof input.agentId === 'string') assertAgentAccess(context, input.agentId)
    const agent = typeof input.agentId === 'string' ? agentStore.get(input.agentId) : undefined
    if (name === 'core.session.create' && agent && isTeamInternalAgent(agent)) throw new Error('团队成员会话由团队会话线管理，不可单独创建')
  }
  if (name.startsWith('studio.task.') || name.startsWith('studio.schedule.') || name === 'create_task' || name === 'core.task.create' || name === 'create_schedule' || name === 'agent.task.watch') {
    for (const key of ['agentId', 'assignAgentId', 'assignee']) {
      if (typeof input[key] === 'string') assertAgentAccess(context, input[key])
    }
    if (typeof input.sessionId === 'string') assertSessionAccess(context, input.sessionId)
    if (typeof input.taskId === 'string') {
      const task = taskStore.get(input.taskId)
      if (task) assertTaskAccess(context, task)
    }
  }
  // Lookup by member ID alone must never grant access to a different team.
  for (const key of ['memberId', 'assigneeMemberId', 'toMemberId']) {
    const id = input[key]
    if (!name.startsWith('team.') || typeof id !== 'string') continue
    const target = teamMemberStore.get(id)
    if (target) assertTeamMemberAccess(context, target.team_id)
  }
}
