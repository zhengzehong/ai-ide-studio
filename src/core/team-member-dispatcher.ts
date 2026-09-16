import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { sessionManager } from './sessions.js'
import { taskStore } from '../store/tasks.js'
import { teamMemberStore } from '../store/teams.js'
import { teamWakeCoordinator } from './team-wake-coordinator.js'

const log = createChildLogger('team-member-dispatch')

export type DispatchMemberPromptStatus = 'accepted' | 'queued'

export interface DispatchMemberPromptInput {
  teamId: string
  memberId: string
  sessionId: string
  prompt: string
  /** Short content shown in the team transcript; prompt remains the model payload. */
  displayContent?: string
  senderName?: string | null
  /** 消息来源署名角色：'team-assignment'=Master 派发（默认）；'team-directed'=用户在团队线里定向发（转录块标「你 → 成员」）。 */
  senderRole?: 'team-assignment' | 'team-directed'
  /** 关联任务：派发最终失败时回写任务状态，避免任务永远停在 running。 */
  taskId?: string
}

const activeMemberSessions = new Set<string>()
/** 每个 session 一个 FIFO 队列：成员忙时派发按顺序排队，不允许后到覆盖先到。 */
const pendingByMemberSession = new Map<string, DispatchMemberPromptInput[]>()

events.on('session:activity', (ev) => {
  if (ev.state === 'idle') drainMemberQueue(ev.sessionId)
})

export function dispatchMemberPrompt(input: DispatchMemberPromptInput): DispatchMemberPromptStatus {
  enqueuePending(input)
  const started = drainMemberQueue(input.sessionId)
  if (started !== input) {
    log.debug(
      { teamId: input.teamId, memberId: input.memberId, sessionId: input.sessionId, queueDepth: pendingByMemberSession.get(input.sessionId)?.length ?? 0 },
      'Team member prompt queued',
    )
    return 'queued'
  }

  return 'accepted'
}

function drainMemberQueue(sessionId: string): DispatchMemberPromptInput | undefined {
  const queue = pendingByMemberSession.get(sessionId)
  if (!queue?.length || activeMemberSessions.has(sessionId) || sessionManager.isPromptActive(sessionId)) return
  const next = queue.shift()!
  if (queue.length === 0) pendingByMemberSession.delete(sessionId)
  activeMemberSessions.add(sessionId)
  log.debug(
    { teamId: next.teamId, memberId: next.memberId, sessionId, taskId: next.taskId, queueDepth: queue.length },
    'Team member prompt dispatch started',
  )
  void runMemberPrompt(next)
  return next
}

async function runMemberPrompt(input: DispatchMemberPromptInput): Promise<void> {
  try {
    await sessionManager.enqueuePrompt(input.sessionId, input.displayContent ?? input.prompt, undefined, {
      modelContent: input.prompt,
      senderRole: input.senderRole ?? 'team-assignment',
      senderName: input.senderName ?? 'Master',
    })
  } catch (err: unknown) {
    log.error(
      { err, teamId: input.teamId, memberId: input.memberId, sessionId: input.sessionId, taskId: input.taskId },
      'Team member prompt failed',
    )
    try {
      reportDispatchFailure(input, err)
    } catch (reportError: unknown) {
      log.error({ err: reportError, teamId: input.teamId, sessionId: input.sessionId, taskId: input.taskId }, 'Team dispatch failure notification failed')
    }
  } finally {
    // done 早于运行锁清理；在 Promise 结算前保留占用，避免 idle 事件提前启动下一条。
    activeMemberSessions.delete(input.sessionId)
    drainMemberQueue(input.sessionId)
  }
}

/** 归档团队时调用：丢弃这些 session 上尚未派发的排队指令（已发出的无法撤回）。 */
export function cancelPendingForSessions(sessionIds: Iterable<string>): void {
  for (const sessionId of sessionIds) {
    const dropped = pendingByMemberSession.get(sessionId)
    if (dropped) {
      pendingByMemberSession.delete(sessionId)
      if (dropped.length > 0) log.info({ sessionId, dropped: dropped.length }, 'Team member pending prompts dropped')
    }
  }
}

/** 只读探针：该成员格子会话上是否还有未派发的排队指令（团队会话线复制前拒绝"忙线"用）。 */
export function hasPendingMemberPrompt(sessionId: string): boolean {
  return (pendingByMemberSession.get(sessionId)?.length ?? 0) > 0
}

/** 只读探针：该成员格子是否有正在执行的派发回合（堵「出队→标 active」的微任务窗口，同上用于复制忙判定）。 */
export function isMemberPromptInFlight(sessionId: string): boolean {
  return activeMemberSessions.has(sessionId)
}

function enqueuePending(input: DispatchMemberPromptInput): void {
  const queue = pendingByMemberSession.get(input.sessionId)
  if (queue) queue.push(input)
  else pendingByMemberSession.set(input.sessionId, [input])
}

function reportDispatchFailure(input: DispatchMemberPromptInput, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  const task = input.taskId ? taskStore.get(input.taskId) : undefined
  if (task && !['completed', 'needs_input', 'cancelled'].includes(task.status)) {
    const updated = taskStore.update(task.id, {
      status: 'needs_input',
      stage: `派发失败:${message}`,
    })
    if (updated) events.emit('task:update', { taskId: updated.id, data: { ...updated, event: 'updated' } })
  }
  teamWakeCoordinator.notifyDispatchFailed({
    teamId: input.teamId, memberId: input.memberId, sessionId: input.sessionId,
    taskId: input.taskId, error: message,
  })
  events.emit('team:update', {
    teamId: input.teamId,
    sessionIds: emitSessionIdsFor(input.teamId, input.sessionId),
    data: { reason: 'member.dispatch_failed' },
  })
}

/** 与 core/teams emitTeamUpdate 同口径：成员 primary 会话 + 本次派发目标（可能是格子会话）。 */
function emitSessionIdsFor(teamId: string, targetSessionId: string): string[] {
  const ids = new Set(teamMemberStore.list(teamId).map((member) => member.session_id))
  ids.add(targetSessionId)
  return [...ids]
}
