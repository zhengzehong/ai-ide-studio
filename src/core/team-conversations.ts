import { sessionStore, type SessionRow } from '../store/sessions.js'
import type { AgentRow } from '../store/agents.js'
import { teamMemberStore, teamStore, type TeamMemberRow, type TeamRow } from '../store/teams.js'
import { projectStore } from '../store/projects.js'
import { teamConversationStore, type TeamConversationRow, type TeamMessageRow } from '../store/team-conversations.js'
import { listTeamActivity } from '../store/team-activity.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { sessionManager, COPYING_STAGE } from './sessions.js'
import { forkSessionInto } from './session-fork.js'
import { hasPendingMemberPrompt, isMemberPromptInFlight } from './team-member-dispatcher.js'
import { publishSessionCreated } from './session-change-events.js'
import { getRuntimePort } from '../runtime/runtime-port-provider.js'

const log = createChildLogger('team-conversations')
function notifyConversationChanged(conversation: TeamConversationRow): void {
  const sessionIds = teamConversationStore.listMembers(conversation.id).flatMap(member => member.session_id ? [member.session_id] : [])
  events.emit('team:update', { teamId: conversation.team_id, sessionIds, data: { conversationId: conversation.id, status: conversation.status } })
  log.info({ teamId: conversation.team_id, conversationId: conversation.id, status: conversation.status }, 'Team conversation changed')
}

export interface TeamConversationDetail {
  conversation: TeamConversationRow
  members: TeamMemberRow[]
  /**
   * 已移除但本线仍有格子的成员：仅供群聊聚合视图保留其历史消息（DB 关系为软删除），
   * 不参与 dock 成员行与成员交互。
   */
  removedMembers: TeamMemberRow[]
  messages: TeamMessageRow[]
}

/** 会话线列表项：在原始行上附线级运行状态与格子清单（含成员格子），供前端点亮与自动选中。 */
export interface TeamConversationListItem extends TeamConversationRow {
  activity_state: 'running' | 'idle'
  grid_session_ids: string[]
  unread: boolean
  last_message_at: string | null
}

function requireTeam(teamId: string): TeamRow {
  const team = teamStore.get(teamId)
  if (!team) throw new Error(`Team 不存在: ${teamId}`)
  return team
}

export function resolveTeamLeaderSession(leaderSessionId: string | undefined, leader: AgentRow, projectId: string): SessionRow {
  if (!leaderSessionId) return sessionStore.create({ agentId: leader.id, projectId })
  const session = sessionStore.get(leaderSessionId)
  if (!session) throw new Error(`Session 不存在: ${leaderSessionId}`)
  if (session.agent_id !== leader.id) throw new Error('Leader session 不属于当前 Agent')
  if (session.project_id !== projectId) throw new Error('Leader session 不属于当前项目')
  return session
}

function withConversationSessions(conversationId: string, members: TeamMemberRow[]): TeamMemberRow[] {
  const sessions = new Map(teamConversationStore.listMembers(conversationId).map((entry) => [entry.member_id, entry.session_id]))
  return members.map((member) => ({ ...member, session_id: sessions.get(member.id) ?? member.session_id }))
}

/**
 * 解析成员进入某条会话线时应使用的 session id（"线 × 成员 = 格子"模型）。
 * - 成员已参与其他活跃线 → 本线新建独立 session；
 * - 首次进线 → 复用 primary session（member.session_id，消除第一期遗留的"孤儿 master"），
 *   但 primary 已有消息（外部 leader 带历史会话等）时新建，避免历史串线。
 */
function resolveMemberConversationSession(member: TeamMemberRow): string {
  if (teamConversationStore.listMemberGrids(member.id).length > 0) {
    return sessionStore.create({ agentId: member.agent_id, projectId: member.project_id }).id
  }
  const primary = member.session_id ? sessionStore.get(member.session_id) : undefined
  if (primary && primary.project_id === member.project_id && !primary.last_message_at) return primary.id
  return sessionStore.create({ agentId: member.agent_id, projectId: member.project_id }).id
}

/** 确保成员在某条活跃会话线里有格子，返回该成员在此线的 session id。 */
export function ensureMemberInConversation(conversationId: string, member: TeamMemberRow): string | undefined {
  const existing = teamConversationStore.listMembers(conversationId).find((entry) => entry.member_id === member.id)
  if (existing?.session_id) return existing.session_id
  const sessionId = resolveMemberConversationSession(member)
  teamConversationStore.addMember(conversationId, member.id, sessionId)
  return sessionId
}

/** 把成员补登记进该团队所有活跃会话线（召唤成员时调用，避免成员掉出已有会话线）。 */
export function ensureMemberInActiveConversations(teamId: string, member: TeamMemberRow): void {
  for (const conversation of teamConversationStore.list(teamId)) {
    if (conversation.status !== 'active') continue
    ensureMemberInConversation(conversation.id, member)
  }
}

export function listTeamConversations(
  teamId: string,
  isPromptActive: (sessionId: string) => boolean = () => false,
): TeamConversationListItem[] {
  requireTeam(teamId)
  const conversations = teamConversationStore.list(teamId)
  if (conversations.length === 0) return []
  return withConversationActivity(teamId, conversations, isPromptActive)
}

/**
 * 线级运行状态聚合：线内任一格子（含成员格子）running → 线 running。
 * 判定与单人绿点同一套 resolveSessionRuntimeState 信号，保证侧栏、统计、聊天窗口径一致。
 */
function withConversationActivity(
  teamId: string,
  conversations: TeamConversationRow[],
  isPromptActive: (sessionId: string) => boolean,
): TeamConversationListItem[] {
  const activityByConversation = new Map(listTeamActivity(isPromptActive, teamId)
    .flatMap(team => team.conversations).map(item => [item.conversationId, item]))
  return conversations.map((conversation) => ({
    ...conversation,
    activity_state: activityByConversation.get(conversation.id)?.running ? 'running' : 'idle',
    grid_session_ids: activityByConversation.get(conversation.id)?.sessionIds ?? [],
    unread: activityByConversation.get(conversation.id)?.unread ?? false,
    last_message_at: activityByConversation.get(conversation.id)?.lastMessageAt ?? null,
  }))
}

/**
 * 深链反查：session → 会话线（仅 master session 命中）。
 * 供"坞里点团队线 / 带 sessionId 的链接"显式映射进团队线视图用；不是"自动选中"语义——
 * 只解析调用方明确给出的 session，绝不替用户挑线。
 */
export function findTeamConversationByMasterSession(
  sessionId: string,
  isPromptActive: (sessionId: string) => boolean = () => false,
): TeamConversationListItem | null {
  const row = teamConversationStore.getBySession(sessionId)
  if (!row || row.master_session_id !== sessionId || row.status !== 'active') return null
  const team = teamStore.get(row.team_id)
  if (!team || team.status !== 'active') return null
  return withConversationActivity(row.team_id, [row], isPromptActive)[0] ?? null
}

export function createTeamConversation(teamId: string, title?: string): TeamConversationDetail {
  const team = requireTeam(teamId)
  const members = teamMemberStore.list(team.id)
  const leader = members.find((member) => member.role === 'leader') ?? members[0]
  if (!leader) throw new Error('Team 没有 Master 成员')
  // Master 的格子即本线 master session：首次开线复用其 primary session，不再新建第二个 master。
  const masterSessionId = resolveMemberConversationSession(leader)
  const conversation = teamConversationStore.create(team.id, masterSessionId, title ?? '')
  for (const member of members) {
    const sessionId = member.id === leader.id ? masterSessionId : resolveMemberConversationSession(member)
    teamConversationStore.addMember(conversation.id, member.id, sessionId)
  }
  notifyConversationChanged(conversation)
  return { conversation, members: withConversationSessions(conversation.id, members), removedMembers: [], messages: [] }
}

export function getTeamConversation(conversationId: string): TeamConversationDetail {
  const conversation = teamConversationStore.get(conversationId)
  if (!conversation) throw new Error('团队会话不存在')
  const allMembers = teamMemberStore.listAll(conversation.team_id)
  const gridMemberIds = new Set(teamConversationStore.listMembers(conversation.id).map((entry) => entry.member_id))
  return {
    conversation,
    members: withConversationSessions(conversation.id, allMembers.filter((member) => member.status !== 'removed')),
    removedMembers: withConversationSessions(
      conversation.id,
      allMembers.filter((member) => member.status === 'removed' && gridMemberIds.has(member.id)),
    ),
    messages: teamConversationStore.listMessages(conversation.id),
  }
}

function updateTeamConversationStatus(conversationId: string, status: string): TeamConversationRow {
  const conversation = teamConversationStore.setStatus(conversationId, status)
  if (!conversation) throw new Error('团队会话不存在')
  notifyConversationChanged(conversation)
  return conversation
}

export function renameTeamConversation(conversationId: string, title: string): TeamConversationRow {
  const conversation = teamConversationStore.updateTitle(conversationId, title)
  if (!conversation) throw new Error('团队会话不存在')
  notifyConversationChanged(conversation)
  return conversation
}

export function archiveTeamConversation(conversationId: string): TeamConversationRow {
  return updateTeamConversationStatus(conversationId, 'archived')
}

export function deleteTeamConversation(conversationId: string): TeamConversationRow {
  return updateTeamConversationStatus(conversationId, 'deleted')
}

// —— 团队会话线复制（P0：空闲线 + 全格子 fork + 空转录 + 整线 all-or-nothing 回滚）——

/** 防连点：源线复制进行中（仿 sessionManager copyingSourceSessions）。 */
const copyingConversations = new Set<string>()

interface TeamConversationCopyPlan {
  memberId: string
  agentId: string
  projectId: string | null
  /** 源格子会话 id；冷格子/无格子时为 null（新格子保持空，跳过 fork）。 */
  sourceSessionId: string | null
  newSessionId: string
}

/** 复制团队会话线：Master + 全部成员格子全部 fork 成新会话，得到一条上下文完整、转录为空的新线。 */
export function copyTeamConversation(conversationId: string): TeamConversationRow {
  const source = teamConversationStore.get(conversationId)
  if (!source) throw new Error('团队会话不存在')
  if (source.status !== 'active') throw new Error('仅活跃中的会话线可以复制')
  if (copyingConversations.has(conversationId)) throw new Error('当前会话线正在复制中，请稍后')

  const grids = teamConversationStore.listMembers(conversationId)

  // 快照语义：新线成员 = 复制发起时在格子里的活跃成员（removedMembers 的历史格子不进新线）。
  const memberById = new Map(teamMemberStore.listAll(source.team_id).map((member) => [member.id, member]))
  const activeGrids = grids.filter((grid) => {
    const member = memberById.get(grid.member_id)
    return !!member && member.status !== 'removed'
  })
  if (activeGrids.length === 0) throw new Error('会话线内没有可复制的成员格子')

  // 忙线拒绝（严格版）：任一待复制格子在跑或还有排队指令都不复制——排队是 dispatcher 内存态，
  // 无法跟到新线，复制出的新线会缺这段对话。in-flight 探针堵「出队→标 active」的微任务窗口。
  for (const grid of activeGrids) {
    if (!grid.session_id) continue
    if (
      sessionManager.isPromptActive(grid.session_id)
      || hasPendingMemberPrompt(grid.session_id)
      || isMemberPromptInFlight(grid.session_id)
    ) {
      throw new Error('团队会话正在运行或有排队消息，空闲后再复制')
    }
  }

  const plans: TeamConversationCopyPlan[] = activeGrids.map((grid) => {
    const member = memberById.get(grid.member_id)!
    const newSession = sessionStore.create({ agentId: member.agent_id, projectId: member.project_id })
    const sourceSession = grid.session_id ? sessionStore.get(grid.session_id) : undefined
    sessionStore.updateTitle(newSession.id, `Fork from ${sourceSession?.title || sourceSession?.id || member.name}`)
    sessionStore.updateStage(newSession.id, COPYING_STAGE)
    // runtime_preferences 随迁：必须先复制再 fork——forkSession 完成时会按目标会话自己的
    // preferences 重放模型/模式/config（sdk-runtime-host applySdkSessionPreferences），
    // 空 preferences 会走默认注入（含 MAX_EFFORT），用户的手切档位/模型全部丢失。
    if (grid.session_id) {
      sessionStore.updateRuntimePreferences(newSession.id, sessionStore.getRuntimePreferences(grid.session_id))
    }
    publishSessionCreated(sessionStore.get(newSession.id)!)
    return {
      memberId: member.id,
      agentId: member.agent_id,
      projectId: member.project_id,
      sourceSessionId: grid.session_id,
      newSessionId: newSession.id,
    }
  })

  // 新线 master = 源 master 所属成员的新格子；异常形态（master 行缺失）退化为 Leader 格子/首格子。
  const sourceMemberId = activeGrids.find((grid) => grid.session_id === source.master_session_id)?.member_id
  const masterPlan = plans.find((plan) => plan.memberId === sourceMemberId)
    ?? plans.find((plan) => memberById.get(plan.memberId)?.role === 'leader')
    ?? plans[0]
  const conversation = teamConversationStore.create(source.team_id, masterPlan.newSessionId, `${source.title || '新团队会话'}（副本）`)
  for (const plan of plans) {
    teamConversationStore.addMember(conversation.id, plan.memberId, plan.newSessionId)
  }
  copyingConversations.add(conversationId)
  notifyConversationChanged(conversation)

  void completeTeamConversationCopy(conversation, source.id, plans)
  return conversation
}

/**
 * 后台逐格子顺序 fork（每格子秒级；WS RPC 15s 超时决定了复制必须异步渐进）。
 * all-or-nothing：任一应 fork 格子失败 → 已建新格子全部关闭/删除 + 新线行置 deleted，不留半截线。
 */
async function completeTeamConversationCopy(
  conversation: TeamConversationRow,
  sourceConversationId: string,
  plans: TeamConversationCopyPlan[],
): Promise<void> {
  try {
    for (const plan of plans) {
      const sourceSession = plan.sourceSessionId ? sessionStore.get(plan.sourceSessionId) : undefined
      if (!plan.sourceSessionId || !sourceSession?.acp_session_id) {
        // 冷格子：从未跑过 prompt，无运行时上下文可搬——新格子保持空，语义无损。
        sessionStore.updateStage(plan.newSessionId, '')
        const updated = sessionStore.get(plan.newSessionId)
        if (updated) publishSessionCreated(updated)
        continue
      }
      const project = plan.projectId ? projectStore.get(plan.projectId) : undefined
      await forkSessionInto({
        sourceSessionId: plan.sourceSessionId,
        targetSessionId: plan.newSessionId,
        projectContext: { projectId: plan.projectId ?? undefined, cwd: project?.work_dir },
      })
      sessionStore.updateStage(plan.newSessionId, '')
      const updated = sessionStore.get(plan.newSessionId)
      if (updated) publishSessionCreated(updated)
    }
    const finished = teamConversationStore.get(conversation.id)
    if (finished) notifyConversationChanged(finished)
    log.info({ teamId: conversation.team_id, conversationId: conversation.id, grids: plans.length }, 'Team conversation copied')
  } catch (err) {
    await rollbackTeamConversationCopy(conversation, sourceConversationId, plans, err)
  } finally {
    copyingConversations.delete(sourceConversationId)
  }
}

/** 整线回滚：closeSession + delete 已建新格子，新线行置 deleted，team:update 携带失败原因供 UI 提示。 */
async function rollbackTeamConversationCopy(
  conversation: TeamConversationRow,
  sourceConversationId: string,
  plans: TeamConversationCopyPlan[],
  err: unknown,
): Promise<void> {
  log.error({ err, teamId: conversation.team_id, conversationId: conversation.id }, 'Team conversation copy failed; rolling back')
  for (const plan of plans) {
    await getRuntimePort().closeSession(plan.agentId, plan.newSessionId).catch(() => undefined)
    try { sessionStore.delete(plan.newSessionId) } catch (deleteErr) {
      log.warn({ err: deleteErr, sessionId: plan.newSessionId }, 'Rollback: failed to delete copied grid session')
    }
  }
  const row = teamConversationStore.get(conversation.id)
  if (row && row.status !== 'deleted') {
    const removed = teamConversationStore.setStatus(conversation.id, 'deleted')
    if (removed) notifyConversationChanged(removed)
  }
  events.emit('team:update', {
    teamId: conversation.team_id,
    sessionIds: plans.map((plan) => plan.newSessionId),
    data: { conversationId: conversation.id, reason: 'conversation.copy_failed', message: err instanceof Error ? err.message : String(err) },
  })
}

export const teamConversationService = {
  listConversations: listTeamConversations,
  conversationByMasterSession: findTeamConversationByMasterSession,
  createConversation: createTeamConversation,
  copyConversation: copyTeamConversation,
  conversationDetail: getTeamConversation,
  renameConversation: renameTeamConversation,
  archiveConversation: archiveTeamConversation,
  deleteConversation: deleteTeamConversation,
}
