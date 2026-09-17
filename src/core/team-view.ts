/**
 * Team 详情读模型（**人的视野**：RPC / UI 团队面板）。
 * 从 core/teams.ts 拆出（该文件有 400 行守卫，先例见 team-archive.ts）。
 *
 * 与 team-line-service.ts 的分工：本模块**不做会话线过滤**——人的视野保持全量（v3 用户明确要求）；
 * agent 的工具视野走 team-line-service（按线硬隔离）。
 */
import { taskStore, type TaskRow } from '../store/tasks.js'
import {
  teamMailboxStore,
  teamMemberStore,
  type TeamMailboxRow,
  type TeamMemberRow,
  type TeamRow,
} from '../store/teams.js'
import { requireTeam } from './teams.js'

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

export const teamViewService = {
  detail(teamId: string): TeamDetail {
    return buildDetail(requireTeam(teamId))
  },

  currentBySession(sessionId: string): TeamContextDetail {
    const currentMember = teamMemberStore.getBySession(sessionId)
    if (!currentMember) return emptyTeamContext()
    const detail = buildDetail(requireTeam(currentMember.team_id))
    return { ...detail, currentMember }
  },
}

function buildDetail(team: TeamRow): TeamDetail {
  return {
    team,
    members: teamMemberStore.list(team.id),
    tasks: taskStore.listByTeam(team.id),
    mailbox: teamMailboxStore.list(team.id, 20),
  }
}

function emptyTeamContext(): TeamContextDetail {
  return { team: null, currentMember: null, members: [], tasks: [], mailbox: [] }
}
