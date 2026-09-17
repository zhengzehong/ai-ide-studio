import { createChildLogger } from './logger.js'
import { events } from './events.js'
import { taskStore, type TaskRow } from '../store/tasks.js'
import type { TeamMemberRow } from '../store/teams.js'

const log = createChildLogger('team-task-assignee')

/**
 * 派发时刻补指派（P0-A，2026-09-17 glm53 汇报丢失事故）：
 * Leader 建任务漏传 assigneeMemberId 时，派发这一刻平台手里就有目标 member ——
 * 只补空、不覆盖；不补则成员更新任务会被拒（"只能更新分配给自己的 Team 任务"），
 * 任务唤醒 / 静默回合兜底 / 重启对账三条路会一起失灵。
 *
 * 注意：调用方必须在本函数**之后**才做 draft/planning 状态早退 ——
 * 否则重派（running）的任务永远补不上（死码陷阱）。
 */
export function backfillTaskAssignee(task: TaskRow, member: TeamMemberRow): TaskRow {
  const assigneeMissing = !task.assignee_member_id
  const agentMissing = !task.assigned_agent_id
  if (!assigneeMissing && !agentMissing) return task
  if (task.assignee_member_id && task.assignee_member_id !== member.id) {
    // 已指派他人：不改写（可能是"一人派、多人协助"的历史用法，也可能是派错人），显式告警留痕。
    log.warn(
      {
        taskId: task.id,
        assigneeMemberId: task.assignee_member_id,
        dispatchedMemberId: member.id,
      },
      'Team task dispatched to a non-assignee member; assignee kept unchanged',
    )
    return task
  }
  const filled = taskStore.update(task.id, {
    ...(assigneeMissing ? { assigneeMemberId: member.id } : {}),
    ...(agentMissing ? { assignAgentId: member.agent_id } : {}),
  })
  if (!filled) return task
  // UI/Agent 侧同步这一变化（与 markTaskDispatched 的状态更新同一事件形态）。
  events.emit('task:update', { taskId: filled.id, data: { ...filled } })
  log.info(
    { taskId: filled.id, memberId: member.id, agentId: member.agent_id },
    'Team task assignee backfilled on dispatch',
  )
  return filled
}
