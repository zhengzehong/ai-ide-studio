/**
 * team.status（P0a）：Leader 调用一次，拿到每个成员"现在干到哪、多久没吭声"的只读快照。
 * 字段级契约见方案文档 §1.2；数据源与算法逐条对应，改动时同步文档。
 *
 * 组成：顶层团队聚合 + 逐成员（运行态 / 各线格子 / 排队深度 / 在飞 / 最后一条唤醒级汇报 / 名下任务统计）。
 * 运行态口径与 UI 绿点、会话线 running 完全一致：resolveSessionRuntimeState（store/session-runtime-state.ts）。
 */
import { sessionStore } from '../../../store/sessions.js'
import { resolveSessionRuntimeState, type SessionRuntimeState } from '../../../store/session-runtime-state.js'
import { taskEventStore, taskStore } from '../../../store/tasks.js'
import { teamMailboxStore, teamMemberStore, teamStore, type TeamMemberRow, type TeamRow } from '../../../store/teams.js'
import { teamConversationStore } from '../../../store/team-conversations.js'
import { teamService } from '../../../core/teams.js'
import { assertTeamMemberAccess } from '../../../core/team-access.js'
import { sessionManager } from '../../../core/sessions.js'
import { getMemberQueueDepth, isMemberPromptInFlight } from '../../../core/team-member-dispatcher.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../../types.js'

const TERMINAL_TASK_STATUSES = new Set(['completed', 'cancelled'])

interface MemberCellStatus {
  conversationId: string
  conversationTitle: string | null
  sessionId: string
  state: SessionRuntimeState
  stage: string | null
}

interface MemberStatus {
  memberId: string
  name: string
  role: string
  agentId: string
  runtimeState: SessionRuntimeState
  cells: MemberCellStatus[]
  hasPendingMemberPrompt: number
  isMemberPromptInFlight: boolean
  lastReport: { type: string; at: string; sinceLastReportMs: number; taskId: string | null } | null
  taskTotal: number
  taskRunning: number
  taskNeedsInput: number
  taskLastUpdateAt: string | null
  taskTitles: string[]
}

export const getTeamStatusHandler: ToolHandler = {
  name: 'team.status',
  description:
    '一次查看团队成员运行态与汇报态（只读快照）：各线格子 running/idle、派发排队深度、是否在飞、'
    + '最后一条给 Leader 的汇报时间与类型、名下任务统计。适用于用户询问进度、被唤醒后跟进、总结前核对。'
    + '这是查询快照，不是订阅：系统会在成员汇报时自动唤醒你，不要轮询本工具。',
  inputSchema: {
    type: 'object',
    properties: { teamId: { type: 'string', description: 'Team ID；不传时使用上下文 Team' } },
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const teamId = resolveTeamId(input, context)
    assertTeamAccess(teamId, context)
    const team = requireTeam(teamId)

    const members = teamMemberStore.list(team.id).filter((member) => member.status === 'active')
    const gridRows = teamConversationStore.listGridActivity(team.id)
    const conversationTitles = new Map(teamConversationStore.list(team.id).map((row) => [row.id, row.title]))
    const tasks = taskStore.listByTeam(team.id)
    const lastTaskEvent = taskEventStore.listLastEventByTaskIds(tasks.map((task) => task.id))
    const now = Date.now()

    const memberStatuses = members
      .map((member) => buildMemberStatus(member, team, gridRows, conversationTitles, tasks, lastTaskEvent, now))
      .sort(compareMembers)

    const runningMembers = memberStatuses.filter((member) => member.runtimeState === 'running').length
    const allIdle = memberStatuses.every((member) => member.runtimeState === 'idle'
      && member.hasPendingMemberPrompt === 0 && !member.isMemberPromptInFlight)

    return jsonResult({
      teamId: team.id,
      teamName: team.name,
      memberCount: memberStatuses.length,
      runningMembers,
      allIdle,
      generatedAt: new Date(now).toISOString(),
      members: memberStatuses,
    })
  },
}

function buildMemberStatus(
  member: TeamMemberRow,
  team: TeamRow,
  gridRows: ReturnType<typeof teamConversationStore.listGridActivity>,
  conversationTitles: Map<string, string>,
  tasks: ReturnType<typeof taskStore.listByTeam>,
  lastTaskEvent: ReturnType<typeof taskEventStore.listLastEventByTaskIds>,
  now: number,
): MemberStatus {
  // 该成员全部会话的 activity_state（primary + 各线格子），与列表页绿点同一套信号（sessions.ts listWithRuntimeState）。
  const runtimeStates = new Map(sessionStore
    .listWithRuntimeState(member.agent_id, team.project_id, sessionManager.isPromptActive)
    .map((row) => [row.id, row.activity_state as SessionRuntimeState]))

  const cells: MemberCellStatus[] = gridRows
    .filter((row) => row.member_id === member.id && row.session_id)
    .map((row) => ({
      conversationId: row.conversation_id,
      conversationTitle: conversationTitles.get(row.conversation_id) ?? null,
      sessionId: row.session_id as string,
      // 格子态优先取聚合查询结果；格子在运行信号表里缺失（会话已关闭/删除）时按同一函数现场判定。
      state: runtimeStates.get(row.session_id as string) ?? resolveSessionRuntimeState({
        promptActive: sessionManager.isPromptActive(row.session_id as string),
        hasRunningAgentMessage: row.has_running_agent_message === 1,
        hasRunningProcessItem: row.has_running_process_item === 1,
        status: row.status ?? '',
        stage: row.stage,
      }),
      stage: row.stage || null,
    }))

  // 成员运行态 = 各线格子 ∪ primary 会话（任一 running 即 running）。
  const primaryState = runtimeStates.get(member.session_id) ?? 'idle'
  const runtimeState: SessionRuntimeState = primaryState === 'running' || cells.some((cell) => cell.state === 'running')
    ? 'running'
    : 'idle'

  const lastMailbox = teamMailboxStore.latestFromMember(team.id, member.id)
  const memberTasks = tasks.filter((task) => task.assignee_member_id === member.id)
  const taskLastUpdateAt = memberTasks
    .map((task) => lastTaskEvent[task.id]?.created_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null

  // 派发队列的键控维度是"格子会话"（dispatchMessage → ensureMemberInConversation 的目标会话），
  // primary 只是其中一格或无会话线时的兜底，因此排队/在飞必须对 primary + 全部格子聚合：
  // 深度取 max、在飞取 any——只查 primary 会让"第二条线起"恒为 0（多线漏报）。
  const dispatchSessionIds = [...new Set([member.session_id, ...cells.map((cell) => cell.sessionId)]).values()]

  return {
    memberId: member.id,
    name: member.name,
    role: member.role,
    agentId: member.agent_id,
    runtimeState,
    cells,
    hasPendingMemberPrompt: Math.max(0, ...dispatchSessionIds.map((sessionId) => getMemberQueueDepth(sessionId))),
    isMemberPromptInFlight: dispatchSessionIds.some((sessionId) => isMemberPromptInFlight(sessionId)),
    lastReport: lastMailbox
      ? {
        type: lastMailbox.type,
        at: lastMailbox.created_at,
        sinceLastReportMs: Math.max(0, now - Date.parse(lastMailbox.created_at)),
        taskId: lastMailbox.task_id,
      }
      : null,
    taskTotal: memberTasks.length,
    taskRunning: memberTasks.filter((task) => task.status === 'running').length,
    taskNeedsInput: memberTasks.filter((task) => task.status === 'needs_input').length,
    taskLastUpdateAt,
    taskTitles: memberTasks.filter((task) => !TERMINAL_TASK_STATUSES.has(task.status)).map((task) => task.title),
  }
}

/** leader 排最前，其余按名字升序。 */
function compareMembers(a: MemberStatus, b: MemberStatus): number {
  if (a.role === b.role) return a.name.localeCompare(b.name)
  if (a.role === 'leader') return -1
  if (b.role === 'leader') return 1
  return a.name.localeCompare(b.name)
}

function resolveTeamId(input: ToolHandlerInput, context: ToolContext): string {
  const teamId = optionalString(input, 'teamId') ?? context.teamId
  if (!teamId) throw new Error('teamId 不能为空')
  return teamId
}

function requireTeam(teamId: string): TeamRow {
  const team = teamStore.get(teamId)
  if (!team) throw new Error(`Team 不存在: ${teamId}`)
  return team
}

function assertTeamAccess(teamId: string, context: ToolContext): void {
  assertTeamMemberAccess(context, teamId)
  teamService.assertAccess(teamId, {
    projectId: context.projectId,
    teamId: context.teamId,
    teamMemberId: context.teamMemberId,
  })
}

function optionalString(input: ToolHandlerInput, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' ? value : undefined
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}
