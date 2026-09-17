import { createChildLogger } from './logger.js'
import { events } from './events.js'
import { taskStore, type TaskRow } from '../store/tasks.js'
import type { TeamMemberRow } from '../store/teams.js'

const log = createChildLogger('team-task-assignee')

export interface AssigneeBackfillResult {
  task: TaskRow
  /** 已指派他人时的告警文案（任务未被改写）；调用方透出给 Master/UI。 */
  warning?: string
}

/**
 * 派发目标与任务既有 assignee 不一致时的告警文案（纯函数，单一事实源）：
 * backfillTaskAssignee 用它写服务端日志，dispatchMessage 用它透传到返回值。
 */
export function assigneeMismatchWarning(task: TaskRow | undefined, member: TeamMemberRow): string | undefined {
  if (!task?.assignee_member_id || task.assignee_member_id === member.id) return undefined
  return `任务 ${task.id} 已指派给其他成员（${task.assignee_member_id}），本次派发给 ${member.name} 未改写指派`
}

/** 可展开进 dispatch 返回值的告警字段（teams.ts 有 400 行上限，故以纯函数形式复用判定）。 */
export function withAssigneeWarning(task: TaskRow | undefined, member: TeamMemberRow): { assigneeWarning?: string } {
  const warning = assigneeMismatchWarning(task, member)
  return warning ? { assigneeWarning: warning } : {}
}

/**
 * 派发时刻补指派（P0-A，2026-09-17 glm53 汇报丢失事故）：
 * Leader 建任务漏传 assigneeMemberId 时，派发这一刻平台手里就有目标 member ——
 * 只补空、不覆盖；不补则成员更新任务会被拒（"只能更新分配给自己的 Team 任务"），
 * 任务唤醒 / 静默回合兜底 / 重启对账三条路会一起失灵。
 *
 * 注意：调用方必须在本函数**之后**才做 draft/planning 状态早退 ——
 * 否则重派（running）的任务永远补不上（死码陷阱）。
 */
export function backfillTaskAssignee(task: TaskRow, member: TeamMemberRow): AssigneeBackfillResult {
  // 告警守卫必须先于"双字段齐全"早退：任务已完整指派给他人（assignee+agent 双非空，典型"派错人"）
  // 时也要留痕告警，否则 warn 只在"assignee 属他人 + agent 缺失"的冷门态才可达（双审 P1-1）。
  const warning = assigneeMismatchWarning(task, member)
  if (warning) {
    log.warn(
      {
        taskId: task.id,
        assigneeMemberId: task.assignee_member_id,
        dispatchedMemberId: member.id,
        assigneeAgentPresent: Boolean(task.assigned_agent_id),
      },
      'Team task dispatched to a non-assignee member; assignee kept unchanged',
    )
    return { task, warning }
  }
  const assigneeMissing = !task.assignee_member_id
  const agentMissing = !task.assigned_agent_id
  if (!assigneeMissing && !agentMissing) return { task }
  const filled = taskStore.update(task.id, {
    ...(assigneeMissing ? { assigneeMemberId: member.id } : {}),
    ...(agentMissing ? { assignAgentId: member.agent_id } : {}),
  })
  if (!filled) return { task }
  // UI/Agent 侧同步这一变化（与 markTaskDispatched 的状态更新同一事件形态；event 供消费方辨识来源）。
  events.emit('task:update', { taskId: filled.id, data: { ...filled, event: 'assignee_backfilled' } })
  log.info(
    { taskId: filled.id, memberId: member.id, agentId: member.agent_id },
    'Team task assignee backfilled on dispatch',
  )
  return { task: filled }
}
