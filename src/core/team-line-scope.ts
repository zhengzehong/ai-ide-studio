/**
 * 会话线隔离（v3，2026-09-17 用户拍板：硬隔离，不开"看全公司"的口子）。
 *
 * 背景：team_mailbox / 任务 / 成员运行态此前都是**团队全局**的——任何一条线的 Master 调
 * team.get / team.mailbox.list / team.task.list / team.status 都会看到全团队所有线的汇报与任务，
 * 表现为"串线"（他线的汇报出现在本线 Master 的视野里，见 docs/analysis/2026-09-17-wakeup-routing-*.md）。
 *
 * 两条口径（本模块是唯一实现处，禁止在别处重复实现）：
 * 1. **写入强制归属**（resolveMailboxLine）：四级兜底 —— 发送会话所在线 → 任务 initiator_session_id 所在线
 *    → 成员主格线（team_members.session_id）→ 团队默认线；全落空 → 返回 null，调用方**拒收**并 warn。
 *    绝不允许存在无归属的"团队级邮件"。
 * 2. **读取按线过滤**（resolveAgentLineScope + taskVisibleInLine）：只读工具视图 = 调用会话所在线
 *    → 调用成员主格线 → 团队默认线；无活跃线 → 返回 null，调用方**拒绝**并明示。
 *    UI 团队面板（人的视野）不走这里，保持全量。
 *
 * 默认线 = 最早的活跃线（created_at ASC, id ASC 确定化）——不引入新的显式配置：团队建线是显式动作，
 * 最早那条就是团队的"主会场"；确定化排序保证同一团队多次调用结果一致（测试与线上可复现）。
 */
import { taskStore, type TaskRow } from '../store/tasks.js'
import { teamMemberStore } from '../store/teams.js'
import { teamConversationStore, type TeamConversationRow } from '../store/team-conversations.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('team-line-scope')

/** 归属/范围解析命中的层级，用于日志与工具结果回显（排查"为什么这封邮件进了这条线"）。 */
export type LineScopeVia = 'session' | 'task' | 'member-primary' | 'team-default'

export interface ResolvedLine {
  conversationId: string
  title: string
  via: LineScopeVia
}

/** agent 只读视图的隔离范围：本线 + 默认线 id（用于判定"归属缺省"的遗留数据）。 */
export interface AgentLineScope extends ResolvedLine {
  defaultConversationId: string | null
}

/** session → 活跃会话线（跨团队/已归档线一律不认）。 */
function lineOfSession(teamId: string, sessionId: string | null | undefined): TeamConversationRow | undefined {
  if (!sessionId) return undefined
  const line = teamConversationStore.getBySession(sessionId)
  if (!line || line.team_id !== teamId || line.status !== 'active') return undefined
  return line
}

/** 任务所属线：任务创建来源会话所在线（任务在别的团队/无来源会话 → 无）。 */
export function taskLine(teamId: string, taskId: string): TeamConversationRow | undefined {
  const task = taskStore.get(taskId)
  if (!task || task.team_id !== teamId) return undefined
  return lineOfSession(teamId, task.initiator_session_id)
}

/** 成员主格线：team_members.session_id（primary）所在线。 */
export function memberPrimaryLine(teamId: string, memberId: string): TeamConversationRow | undefined {
  const member = teamMemberStore.get(memberId)
  if (!member || member.team_id !== teamId) return undefined
  return lineOfSession(teamId, member.session_id)
}

/** 团队默认线：最早的活跃线（创建顺序第一条；created_at 同毫秒用 rowid 兜底，见 listActiveByCreation）。 */
export function defaultLine(teamId: string): TeamConversationRow | undefined {
  return teamConversationStore.listActiveByCreation(teamId)[0]
}

function toResolved(line: TeamConversationRow, via: LineScopeVia): ResolvedLine {
  return { conversationId: line.id, title: line.title, via }
}

/**
 * 邮件写入归属四级兜底。全链路落空（团队没有任何活跃线）→ null，调用方拒收。
 * 顺序即语义：谁发的（会话）> 汇报的是哪件事（任务）> 谁（成员主格）> 团队主会场（默认线）。
 */
export function resolveMailboxLine(input: {
  teamId: string
  sourceSessionId?: string
  taskId?: string
  fromMemberId?: string
}): ResolvedLine | null {
  const bySession = lineOfSession(input.teamId, input.sourceSessionId)
  if (bySession) return toResolved(bySession, 'session')
  const byTask = input.taskId ? taskLine(input.teamId, input.taskId) : undefined
  if (byTask) return toResolved(byTask, 'task')
  const byMember = input.fromMemberId ? memberPrimaryLine(input.teamId, input.fromMemberId) : undefined
  if (byMember) return toResolved(byMember, 'member-primary')
  const fallback = defaultLine(input.teamId)
  if (fallback) return toResolved(fallback, 'team-default')
  log.warn(
    { teamId: input.teamId, sourceSessionId: input.sourceSessionId, taskId: input.taskId, fromMemberId: input.fromMemberId },
    'Team mailbox line unresolved (no active conversation); message rejected',
  )
  return null
}

/**
 * agent 只读视图的隔离范围：调用会话所在线 → 调用成员主格线 → 团队默认线。
 * 无会话上下文（脚本/定时调用）时用调用者默认线；团队也没有活跃线 → null，调用方拒绝并明示。
 */
export function resolveAgentLineScope(input: {
  teamId: string
  sessionId?: string
  teamMemberId?: string
}): AgentLineScope | null {
  const bySession = lineOfSession(input.teamId, input.sessionId)
  if (bySession) return scopeOf(input.teamId, bySession, 'session')
  const byMember = input.teamMemberId ? memberPrimaryLine(input.teamId, input.teamMemberId) : undefined
  if (byMember) return scopeOf(input.teamId, byMember, 'member-primary')
  const fallback = defaultLine(input.teamId)
  if (fallback) {
    log.info(
      { teamId: input.teamId, sessionId: input.sessionId, teamMemberId: input.teamMemberId, conversationId: fallback.id },
      'Team line scope fell back to default conversation',
    )
    return scopeOf(input.teamId, fallback, 'team-default')
  }
  log.warn(
    { teamId: input.teamId, sessionId: input.sessionId, teamMemberId: input.teamMemberId },
    'Team line scope unresolved (no active conversation); tool call rejected',
  )
  return null
}

function scopeOf(teamId: string, line: TeamConversationRow, via: LineScopeVia): AgentLineScope {
  return { ...toResolved(line, via), defaultConversationId: defaultLine(teamId)?.id ?? null }
}

/**
 * 任务是否属于该线：任务来源会话在该线 → 是；任务无来源会话（历史数据/直接建任务）→ 归默认线
 * （与 mailbox 遗留 NULL 行同口径，不会同时出现在多条线）；任务在别条线 → 否。
 */
export function taskVisibleInLine(teamId: string, task: TaskRow, scope: AgentLineScope): boolean {
  const line = taskLine(teamId, task.id)
  if (line) return line.id === scope.conversationId
  return scope.conversationId === scope.defaultConversationId
}

/** 成员是否在本线有格子（team.status / team.get 的成员可见性口径）。 */
export function memberInLine(conversationId: string, memberId: string): boolean {
  return teamConversationStore.listMembers(conversationId).some((grid) => grid.member_id === memberId)
}

/** 工具结果里回显的隔离范围（agent 自查"我现在看的是哪条线"）。 */
export function describeLineScope(scope: AgentLineScope): { conversationId: string; title: string; via: LineScopeVia; defaultConversationId: string | null } {
  return {
    conversationId: scope.conversationId,
    title: scope.title,
    via: scope.via,
    defaultConversationId: scope.defaultConversationId,
  }
}
