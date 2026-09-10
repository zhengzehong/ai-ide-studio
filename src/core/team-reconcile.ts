import { taskStore, type TaskRow } from '../store/tasks.js'
import { teamMemberStore } from '../store/teams.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { teamWakeCoordinator } from './team-wake-coordinator.js'

const log = createChildLogger('team-reconcile')

/**
 * 服务重启对账：派发/唤醒队列都是内存态，重启即丢失。
 * 把重启前处于 running 的团队任务标记为 needs_input，让 Master 被唤醒后重新派发，
 * 而不是让任务永远停在 running 假装还在执行。
 */
export function reconcileInterruptedTeamTasks(): { reconciled: number } {
  const candidates = taskStore.list('running').filter((task): task is TaskRow & { team_id: string } => Boolean(task.team_id))
  const touchedTeams = new Set<string>()
  for (const task of candidates) {
    const updated = taskStore.update(task.id, {
      status: 'needs_input',
      stage: '服务重启，成员执行中断；请在 Team 里重新派发或检查成员会话',
    })
    if (!updated) continue
    events.emit('task:update', { taskId: updated.id, data: { ...updated, event: 'updated' } })
    if (task.assignee_member_id) {
      try {
        teamWakeCoordinator.notifyTaskUpdated(updated, { teamMemberId: task.assignee_member_id })
      } catch (err) {
        log.warn({ err, taskId: updated.id }, 'Team task reconcile wake failed')
      }
    }
    touchedTeams.add(task.team_id)
  }
  for (const teamId of touchedTeams) {
    events.emit('team:update', {
      teamId,
      sessionIds: teamMemberStore.list(teamId).map((member) => member.session_id),
      data: { reason: 'tasks.reconciled' },
    })
  }
  if (candidates.length > 0) log.warn({ reconciled: candidates.length }, '重启后已对账中断的 Team 任务')
  return { reconciled: candidates.length }
}
