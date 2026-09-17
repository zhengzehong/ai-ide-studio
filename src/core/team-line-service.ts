/**
 * 会话线隔离的服务层（v3，2026-09-17 用户拍板"硬隔离"）。
 *
 * 与 core/teams.ts 的分工：teams.ts 放编排动作与**人的视野**（RPC/UI：detail/listMailbox 全量），
 * 本模块只放"按会话线的读写口径"——邮箱写入归属、agent 工具视图按线过滤、建线兜底。
 * 拆成独立文件的直接原因：teams.ts 有 400 行守卫（tests/unit/file-size-policy.test.ts）。
 *
 * 口径实现见 core/team-line-scope.ts（唯一判定处，本模块只做组装与拒绝话术）。
 */
import { taskStore, type TaskRow } from '../store/tasks.js'
import {
  teamMailboxStore,
  teamMemberStore,
  type TeamMailboxRow,
  type TeamRow,
} from '../store/teams.js'
import { teamConversationService } from './team-conversations.js'
import { createChildLogger } from './logger.js'
import {
  defaultLine,
  memberInLine,
  resolveAgentLineScope,
  resolveMailboxLine,
  taskVisibleInLine,
  type AgentLineScope,
  type ResolvedLine,
} from './team-line-scope.js'
import { requireTeam, type TeamDetail } from './teams.js'

const log = createChildLogger('team-line-service')

export const teamLineService = {
  /** 全量 mailbox（人的视野：UI 团队面板 / RPC）。**agent 工具视图必须走 listMailboxForLine**。 */
  listMailbox(teamId: string, limit?: number): TeamMailboxRow[] {
    requireTeam(teamId)
    return teamMailboxStore.list(teamId, limit)
  },

  /** agent 工具视图的隔离范围（调用会话所在线 → 成员主格线 → 团队默认线；无活跃线直接拒绝）。 */
  lineScope(teamId: string, input: { sessionId?: string; teamMemberId?: string }): AgentLineScope {
    requireTeam(teamId)
    const scope = resolveAgentLineScope({ teamId, sessionId: input.sessionId, teamMemberId: input.teamMemberId })
    if (!scope) {
      throw new Error(
        `Team ${teamId} 当前没有任何活跃会话线，无法确定隔离范围（团队邮箱与任务按会话线硬隔离，每条线的 Master 只看本线）。`
        + '请先在团队面板创建或恢复一条会话线后重试。',
      )
    }
    return scope
  },

  /** 单线 mailbox 视图（agent 工具）：本线邮件 + 归属缺省行（仅默认线可见）。 */
  listMailboxForLine(teamId: string, scope: AgentLineScope, limit?: number): TeamMailboxRow[] {
    requireTeam(teamId)
    return teamMailboxStore.listForLine(teamId, scope, limit)
  },

  /** 单线任务视图（agent 工具）：只看本线来源的任务；无来源会话的历史任务归默认线。 */
  listTasksForLine(teamId: string, scope: AgentLineScope, status?: string): TaskRow[] {
    requireTeam(teamId)
    return taskStore.listByTeam(teamId, status).filter((task) => taskVisibleInLine(teamId, task, scope))
  },

  /** 单线 Team 详情（agent 工具 team.get）：成员限本线有格子者，任务与 mailbox 按线过滤；名册另见 team.member.list。 */
  detailForLine(teamId: string, scope: AgentLineScope): TeamDetail & { lineScope: AgentLineScope } {
    const team = requireTeam(teamId)
    return {
      team,
      members: teamMemberStore.list(team.id).filter((member) => memberInLine(scope.conversationId, member.id)),
      tasks: taskStore.listByTeam(team.id).filter((task) => taskVisibleInLine(team.id, task, scope)),
      mailbox: teamMailboxStore.listForLine(team.id, scope, 20),
      lineScope: scope,
    }
  },

  /**
   * 确保团队有一条活跃会话线（缺则开首线），返回该线。
   * 建线本来是**人**在团队面板里的动作（RPC team.conversation.create），agent 没有建线工具；
   * 而 v3 硬隔离下没有线的团队收不了 mailbox（写入无归属 → 拒收），等于"成员汇报必丢"。
   * 因此 agent 建团队的路径（team.create 工具）建团队时同步开一条首线——语义与面板首线完全一致。
   */
  ensureDefaultConversation(teamId: string) {
    const existing = defaultLine(teamId)
    if (existing) return existing
    return teamConversationService.createConversation(teamId).conversation
  },
}

/**
 * sendMailbox 的归属解析：四级兜底（会话 → 任务 → 成员主格 → 团队默认线）。
 * 全链路落空 → **拒收**（抛错，绝不写无归属的"团队级邮件"）；未绑任务的汇报/结果 → 留痕告警
 * （工具层已拒收，见 sendTeamMailboxHandler；服务层保留写入能力但不静默）。
 */
export function resolveMailboxLineOrReject(
  team: TeamRow,
  input: { type: string; taskId?: string; fromMemberId?: string; sourceSessionId?: string },
): ResolvedLine {
  const line = resolveMailboxLine({
    teamId: team.id,
    sourceSessionId: input.sourceSessionId,
    taskId: input.taskId,
    fromMemberId: input.fromMemberId,
  })
  if (!line) {
    throw new Error(
      `Team ${team.id} 当前没有任何活跃会话线，留言无法归属到会话线，已拒收（团队邮箱按会话线硬隔离，不接受无归属的团队级留言）。`
      + '请先在团队面板创建或恢复一条会话线后重试。',
    )
  }
  if (!input.taskId && (input.type === 'report' || input.type === 'result')) {
    log.warn(
      { teamId: team.id, fromMemberId: input.fromMemberId, type: input.type, conversationId: line.conversationId },
      'Team mailbox wrote an unbound report/result (no taskId)',
    )
  }
  return line
}
