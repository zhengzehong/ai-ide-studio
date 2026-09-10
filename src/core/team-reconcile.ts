import { taskStore, type TaskRow } from '../store/tasks.js'
import { teamMailboxStore, teamMemberStore, teamStore } from '../store/teams.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { teamWakeCoordinator } from './team-wake-coordinator.js'

const log = createChildLogger('team-reconcile')

/** 重启对账只回看最近这段窗口内的汇报；更早的汇报在运行期必然已触发过唤醒或被用户处理。 */
const WAKE_RECOVERY_WINDOW_MS = 10 * 60 * 1000

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

/**
 * 重启对账的另一半：派发/唤醒队列是内存态，重启即丢。中断的任务由上面的任务对账兜底，
 * 这里补的是"不绑任务的纯汇报"——成员 mailbox.send 后唤醒定时器还没来得及触发就重启，
 * Leader 永远不会被叫醒。每个团队只取窗口内最新一条候选，交给 coordinator 判定是否补唤醒。
 */
export function reconcilePendingTeamWakes(): { recovered: number } {
  const since = new Date(Date.now() - WAKE_RECOVERY_WINDOW_MS).toISOString()
  let recovered = 0
  for (const team of teamStore.list()) {
    const candidates = teamMailboxStore
      .list(team.id, 50)
      .filter((message) => !message.task_id && message.created_at >= since)
    // list 按 created_at 升序返回，最后一个即最新。
    const latest = candidates.at(-1)
    if (!latest) continue
    try {
      if (teamWakeCoordinator.recoverPendingWake(latest)) recovered += 1
    } catch (err) {
      log.warn({ err, teamId: team.id, messageId: latest.id }, 'Team wake recovery failed')
    }
  }
  if (recovered > 0) log.warn({ recovered }, '重启后已补发丢失的 Team Leader 唤醒')
  return { recovered }
}
