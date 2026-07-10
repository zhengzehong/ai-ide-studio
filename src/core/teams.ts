import { agentStore, type AgentRow } from '../store/agents.js'
import { templateStore, type AgentTemplateRow } from '../store/agent-templates.js'
import { projectStore } from '../store/projects.js'
import { sessionStore, type SessionRow } from '../store/sessions.js'
import { taskStore, type TaskRow } from '../store/tasks.js'
import {
  teamMailboxStore,
  teamMemberStore,
  teamStore,
  type TeamMailboxRow,
  type TeamMemberRow,
  type TeamRow,
} from '../store/teams.js'
import { createCustomProjectAgent, deployTemplateToProject } from './agents.js'
import { events } from './events.js'
import { emitTaskLifecycleEvent, resolveTaskLifecycleChangeType } from './task-lifecycle-events.js'
import { createChildLogger } from './logger.js'
import { dispatchMemberPrompt, type DispatchMemberPromptStatus } from './team-member-dispatcher.js'
import { buildTeamMemberPrompt } from './team-prompts.js'
import { teamWakeCoordinator } from './team-wake-coordinator.js'
import { applyToolProfileToAgent } from '../tools/team-profiles.js'

const log = createChildLogger('teams')

export interface TeamDetail {
  team: TeamRow
  members: TeamMemberRow[]
  tasks: TaskRow[]
  mailbox: TeamMailboxRow[]
}

export interface TeamContextDetail {
  team: TeamRow | null
  currentMember: TeamMemberRow | null
  members: TeamMemberRow[]
  tasks: TaskRow[]
  mailbox: TeamMailboxRow[]
}

export interface CreateTeamInput {
  projectId: string
  leaderAgentId: string
  leaderSessionId?: string
  name: string
  description?: string
}

export interface SpawnMemberInput {
  teamId: string
  templateId?: string
  agentId?: string
  name?: string
  type?: string
  runtime?: string
  systemPrompt?: string
  icon?: string
  role?: string
}

export interface SpawnMemberResult {
  member: TeamMemberRow
  agent: AgentRow
  session: SessionRow
}

export interface CreateTeamResult extends SpawnMemberResult { team: TeamRow }

export interface DispatchTeamMessageResult {
  status: DispatchMemberPromptStatus
  member: TeamMemberRow
}

export interface CreateTeamTaskInput {
  teamId: string
  title: string
  description?: string
  assigneeMemberId?: string
}

export interface UpdateTeamTaskInput {
  teamId: string
  taskId: string
  status?: string
  stage?: string
  assigneeMemberId?: string | null
  actor?: { teamMemberId?: string }
}

export interface TeamAccessContext {
  projectId?: string
  teamId?: string
  teamMemberId?: string
}

export const teamService = {
  list(projectId?: string): TeamRow[] {
    return teamStore.list(projectId)
  },

  detail(teamId: string): TeamDetail {
    const team = requireTeam(teamId)
    return buildDetail(team)
  },

  currentBySession(sessionId: string): TeamContextDetail {
    const currentMember = teamMemberStore.getBySession(sessionId)
    if (!currentMember) return emptyTeamContext()
    const detail = buildDetail(requireTeam(currentMember.team_id))
    return { ...detail, currentMember }
  },

  create(input: CreateTeamInput): CreateTeamResult {
    ensureProject(input.projectId)
    const leader = requireAgent(input.leaderAgentId)
    ensureAgentInProject(leader, input.projectId)
    const team = teamStore.create({ projectId: input.projectId, name: input.name, description: input.description })
    const session = resolveLeaderSession(input.leaderSessionId, leader, input.projectId)
    const member = teamMemberStore.create({
      teamId: team.id,
      projectId: input.projectId,
      agentId: leader.id,
      sessionId: session.id,
      name: leader.name,
      role: 'leader',
    })
    log.info({ teamId: team.id, projectId: input.projectId, memberId: member.id }, 'Team 已创建')
    emitTeamUpdate(team.id, 'created')
    return { team, member, agent: leader, session }
  },

  update(teamId: string, input: { name?: string; description?: string | null; status?: string }): TeamRow {
    const team = teamStore.update(teamId, input)
    if (!team) throw new Error(`Team 不存在: ${teamId}`)
    emitTeamUpdate(team.id, 'updated')
    return team
  },

  listMembers(teamId: string): TeamMemberRow[] {
    requireTeam(teamId)
    return teamMemberStore.list(teamId)
  },

  spawnMember(input: SpawnMemberInput): SpawnMemberResult {
    const team = requireTeam(input.teamId)
    const agent = resolveSpawnAgent(team.project_id, input)
    ensureAgentInProject(agent, team.project_id)
    const session = sessionStore.create({ agentId: agent.id, projectId: team.project_id })
    const member = teamMemberStore.create({
      teamId: team.id,
      projectId: team.project_id,
      agentId: agent.id,
      sessionId: session.id,
      name: input.name?.trim() || agent.name,
      role: input.role || 'member',
    })
    applyToolProfileToAgent({ profileId: 'team-member', agentId: agent.id })
    log.info({ teamId: team.id, memberId: member.id, agentId: agent.id }, 'Team member 已创建')
    events.emit('session:changed', { sessionId: session.id, data: { ...session } })
    emitTeamUpdate(team.id, 'member.created')
    return { member, agent, session }
  },

  dispatchMessage(input: {
    teamId: string
    memberId: string
    content: string
    taskId?: string
  }): DispatchTeamMessageResult {
    const team = requireTeam(input.teamId)
    const member = requireMember(input.memberId)
    ensureMemberInTeam(member, team)
    const task = input.taskId ? ensureTaskInTeam(input.taskId, team.id) : undefined
    if (task) markTaskDispatched(team.id, task, member)
    const prompt = buildTeamMemberPrompt({ team, member, content: input.content, taskId: input.taskId })
    const status = dispatchMemberPrompt({ teamId: team.id, memberId: member.id, sessionId: member.session_id, prompt })
    return { status, member }
  },

  listMailbox(teamId: string, limit?: number): TeamMailboxRow[] {
    requireTeam(teamId)
    return teamMailboxStore.list(teamId, limit)
  },

  sendMailbox(input: {
    teamId: string
    type: string
    content: string
    fromMemberId?: string
    toMemberId?: string
    taskId?: string
    payload?: unknown
  }): TeamMailboxRow {
    const team = requireTeam(input.teamId)
    if (input.fromMemberId) ensureMemberInTeam(requireMember(input.fromMemberId), team)
    if (input.toMemberId) ensureMemberInTeam(requireMember(input.toMemberId), team)
    if (input.taskId) ensureTaskInTeam(input.taskId, team.id)
    const message = teamMailboxStore.create({
      teamId: team.id,
      projectId: team.project_id,
      fromMemberId: input.fromMemberId,
      toMemberId: input.toMemberId,
      taskId: input.taskId,
      type: input.type,
      content: input.content,
      payload: input.payload,
    })
    teamWakeCoordinator.notifyMailbox(message)
    emitTeamUpdate(team.id, 'mailbox.created')
    return message
  },

  listTasks(teamId: string, status?: string): TaskRow[] {
    requireTeam(teamId)
    return taskStore.listByTeam(teamId, status)
  },

  createTask(input: CreateTeamTaskInput): TaskRow {
    const team = requireTeam(input.teamId)
    const assignee = input.assigneeMemberId ? requireMember(input.assigneeMemberId) : undefined
    if (assignee) ensureMemberInTeam(assignee, team)
    let task = taskStore.create({
      title: input.title,
      description: input.description ?? input.title,
      source: 'agent',
      projectId: team.project_id,
      teamId: team.id,
      assigneeMemberId: assignee?.id,
    })
    if (assignee) {
      taskStore.assignAgent(task.id, assignee.agent_id)
      task = taskStore.get(task.id) ?? task
    }
    emitTaskUpdate(task, 'created')
    emitTaskLifecycleEvent(task, 'created', null)
    emitTeamUpdate(team.id, 'task.created')
    return task
  },

  updateTask(input: UpdateTeamTaskInput): TaskRow {
    const team = requireTeam(input.teamId)
    const task = ensureTaskInTeam(input.taskId, team.id)
    const actor = input.actor?.teamMemberId ? requireMember(input.actor.teamMemberId) : undefined
    if (actor) {
      ensureMemberInTeam(actor, team)
      if (actor.role !== 'leader') {
        if (task.assignee_member_id !== actor.id) throw new Error('只能更新分配给自己的 Team 任务')
        if (input.assigneeMemberId !== undefined && input.assigneeMemberId !== task.assignee_member_id) {
          throw new Error('Team 成员不能重新分配任务')
        }
      }
    }
    const assignee = input.assigneeMemberId ? requireMember(input.assigneeMemberId) : undefined
    if (assignee) ensureMemberInTeam(assignee, team)
    const unassigning = input.assigneeMemberId === null
    const updated = taskStore.update(task.id, {
      status: normalizeTaskStatus(input.status),
      stage: input.stage,
      assigneeMemberId: input.assigneeMemberId,
      assignAgentId: unassigning ? null : assignee?.agent_id,
    })
    if (!updated) throw new Error(`Task 不存在: ${task.id}`)
    teamWakeCoordinator.notifyTaskUpdated(updated, input.actor)
    emitTaskUpdate(updated, 'updated')
    emitTaskLifecycleEvent(updated, resolveTaskLifecycleChangeType(task, updated), task.status)
    emitTeamUpdate(team.id, 'task.updated')
    return updated
  },

  listTemplates(): AgentTemplateRow[] {
    return templateStore.list()
  },

  describeTemplate(templateId: string): AgentTemplateRow {
    const template = templateStore.get(templateId)
    if (!template) throw new Error(`Agent 模板不存在: ${templateId}`)
    return template
  },

  assertAccess(teamId: string, context: TeamAccessContext): void {
    const team = requireTeam(teamId)
    if (context.projectId && team.project_id !== context.projectId) throw new Error('Team 不属于当前项目')
    if (context.teamId && context.teamId !== team.id) throw new Error('teamId 不匹配当前 Team 上下文')
    if (context.teamMemberId) ensureMemberInTeam(requireMember(context.teamMemberId), team)
  },
}

function resolveLeaderSession(leaderSessionId: string | undefined, leader: AgentRow, projectId: string): SessionRow {
  if (!leaderSessionId) return sessionStore.create({ agentId: leader.id, projectId })
  const session = sessionStore.get(leaderSessionId)
  if (!session) throw new Error(`Session 不存在: ${leaderSessionId}`)
  if (session.agent_id !== leader.id) throw new Error('Leader session 不属于当前 Agent')
  if (session.project_id !== projectId) throw new Error('Leader session 不属于当前项目')
  return session
}
function emptyTeamContext(): TeamContextDetail { return { team: null, currentMember: null, members: [], tasks: [], mailbox: [] } }

function emitTeamUpdate(teamId: string, reason: string): void {
  events.emit('team:update', {
    teamId,
    sessionIds: teamMemberStore.list(teamId).map((member) => member.session_id),
    data: { reason },
  })
}

function emitTaskUpdate(task: TaskRow, event: 'created' | 'updated'): void {
  events.emit('task:update', { taskId: task.id, data: { ...task, event } })
}

function markTaskDispatched(teamId: string, task: TaskRow, member: TeamMemberRow): void {
  if (!['draft', 'planning'].includes(task.status)) return
  const updated = taskStore.update(task.id, {
    status: 'running',
    stage: `已派发给 ${member.name}，等待成员汇报`,
  })
  if (!updated) return

  events.emit('task:update', { taskId: updated.id, data: { ...updated } })
  emitTaskLifecycleEvent(updated, 'assigned', task.status)
  emitTeamUpdate(teamId, 'task.dispatched')
}

function buildDetail(team: TeamRow): TeamDetail {
  return {
    team,
    members: teamMemberStore.list(team.id),
    tasks: taskStore.listByTeam(team.id),
    mailbox: teamMailboxStore.list(team.id, 20),
  }
}

function resolveSpawnAgent(projectId: string, input: SpawnMemberInput): AgentRow {
  if (input.agentId) return requireAgent(input.agentId)
  if (input.templateId) {
    return deployTemplateToProject(input.templateId, projectId, {
      name: input.name,
      runtime: input.runtime,
      systemPrompt: input.systemPrompt,
      icon: input.icon,
    })
  }
  return createCustomProjectAgent({
    projectId,
    name: required(input.name, 'name'),
    type: required(input.type, 'type'),
    runtime: required(input.runtime, 'runtime'),
    systemPrompt: input.systemPrompt,
    icon: input.icon,
  })
}

function ensureProject(projectId: string): void {
  if (!projectStore.get(projectId)) throw new Error(`项目不存在: ${projectId}`)
}

function requireTeam(teamId: string): TeamRow {
  const team = teamStore.get(teamId)
  if (!team) throw new Error(`Team 不存在: ${teamId}`)
  return team
}

function requireMember(memberId: string): TeamMemberRow {
  const member = teamMemberStore.get(memberId)
  if (!member) throw new Error(`Team member 不存在: ${memberId}`)
  return member
}

function requireAgent(agentId: string): AgentRow {
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`Agent 不存在: ${agentId}`)
  return agent
}

function ensureAgentInProject(agent: AgentRow, projectId: string): void {
  if (agent.project_id !== projectId) throw new Error(`Agent 不属于项目: ${projectId}`)
}

function ensureMemberInTeam(member: TeamMemberRow, team: TeamRow): void {
  if (member.team_id !== team.id || member.project_id !== team.project_id) throw new Error('Team member 不属于该 Team')
}

function ensureTaskInTeam(taskId: string, teamId: string): TaskRow {
  const task = taskStore.get(taskId)
  if (!task) throw new Error(`Task 不存在: ${taskId}`)
  if (task.team_id !== teamId) throw new Error('Task 不属于该 Team')
  return task
}

function required(value: string | undefined, key: string): string {
  if (!value?.trim()) throw new Error(`${key} 不能为空`)
  return value
}

function normalizeTaskStatus(status: string | undefined): string | undefined {
  if (!status) return undefined
  const normalized = status.trim().toLowerCase()
  if (['done', 'complete', 'finished'].includes(normalized)) return 'completed'
  return status
}
