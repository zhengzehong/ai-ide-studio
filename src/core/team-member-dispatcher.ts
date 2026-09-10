import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { sessionManager } from './sessions.js'
import { taskStore } from '../store/tasks.js'
import { teamMemberStore } from '../store/teams.js'

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
  /** 关联任务：派发最终失败时回写任务状态，避免任务永远停在 running。 */
  taskId?: string
}

const activeMemberSessions = new Set<string>()
/** 每个 session 一个 FIFO 队列：成员忙时派发按顺序排队，不允许后到覆盖先到。 */
const pendingByMemberSession = new Map<string, DispatchMemberPromptInput[]>()

events.on('session:done', (ev) => {
  activeMemberSessions.delete(ev.sessionId)
  const queue = pendingByMemberSession.get(ev.sessionId)
  if (!queue || queue.length === 0) return
  // 每次只消费一条：后续条目等本轮 done 再次触发，保证同一 session 内严格串行。
  const next = queue.shift()!
  if (queue.length === 0) pendingByMemberSession.delete(ev.sessionId)
  dispatchMemberPrompt(next)
})

export function dispatchMemberPrompt(input: DispatchMemberPromptInput): DispatchMemberPromptStatus {
  if (sessionManager.isPromptActive(input.sessionId) || activeMemberSessions.has(input.sessionId)) {
    enqueuePending(input)
    log.debug(
      { teamId: input.teamId, memberId: input.memberId, sessionId: input.sessionId, queueDepth: pendingByMemberSession.get(input.sessionId)?.length ?? 0 },
      'Team member prompt queued',
    )
    return 'queued'
  }

  activeMemberSessions.add(input.sessionId)
  void sessionManager
    .enqueuePrompt(input.sessionId, input.displayContent ?? input.prompt, undefined, {
      modelContent: input.prompt,
      senderRole: 'team-assignment',
      senderName: input.senderName ?? 'Master',
    })
    .then(() => {
      activeMemberSessions.delete(input.sessionId)
    })
    .catch((err: unknown) => {
      if (isActivePromptError(err)) {
        enqueuePending(input)
        log.debug(
          { teamId: input.teamId, memberId: input.memberId, sessionId: input.sessionId },
          'Team member prompt queued',
        )
        return
      }
      activeMemberSessions.delete(input.sessionId)
      log.error(
        { err, teamId: input.teamId, memberId: input.memberId, sessionId: input.sessionId },
        'Team member prompt failed',
      )
      reportDispatchFailure(input, err)
    })
  return 'accepted'
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

function enqueuePending(input: DispatchMemberPromptInput): void {
  const queue = pendingByMemberSession.get(input.sessionId)
  if (queue) queue.push(input)
  else pendingByMemberSession.set(input.sessionId, [input])
}

function reportDispatchFailure(input: DispatchMemberPromptInput, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  if (!input.taskId) return
  const task = taskStore.get(input.taskId)
  if (!task || ['completed', 'needs_input', 'cancelled'].includes(task.status)) return
  const updated = taskStore.update(input.taskId, {
    status: 'needs_input',
    stage: `派发失败:${message}`,
  })
  if (!updated) return
  events.emit('task:update', { taskId: updated.id, data: { ...updated, event: 'updated' } })
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

function isActivePromptError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('当前会话正在生成中')
}
