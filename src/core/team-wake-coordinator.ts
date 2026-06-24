import { taskStore, type TaskRow } from '../store/tasks.js'
import { teamMemberStore, teamStore, type TeamMailboxRow, type TeamMemberRow, type TeamRow } from '../store/teams.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { sessionManager } from './sessions.js'
import { buildLeaderWakePrompt } from './team-prompts.js'

const log = createChildLogger('team-wake')
const WAKE_MAILBOX_TYPES = new Set(['report', 'result', 'question', 'blocked'])
const WAKE_TASK_STATUSES = new Set(['completed', 'needs_input'])
const WAKE_DELAY_MS = 2_000
const TASK_MAILBOX_WAKE_DELAY_MS = 15_000
const activeLeaderSessions = new Set<string>()
const pendingByLeaderSession = new Map<string, string>()
const wakeTimers = new Map<string, ReturnType<typeof setTimeout>>()

events.on('session:done', (ev) => {
  activeLeaderSessions.delete(ev.sessionId)
  const pending = pendingByLeaderSession.get(ev.sessionId)
  if (!pending) return
  const existingTimer = wakeTimers.get(ev.sessionId)
  if (existingTimer) clearTimeout(existingTimer)
  const timer = setTimeout(() => flushLeaderWake(ev.sessionId), WAKE_DELAY_MS)
  timer.unref?.()
  wakeTimers.set(ev.sessionId, timer)
})

events.on('session:manual-prompt-started', (ev) => {
  if (!pendingByLeaderSession.has(ev.sessionId)) return
  const existingTimer = wakeTimers.get(ev.sessionId)
  if (existingTimer) {
    clearTimeout(existingTimer)
    wakeTimers.delete(ev.sessionId)
  }
  log.debug({ leaderSessionId: ev.sessionId }, 'Team Leader wake paused behind manual prompt')
})

export const teamWakeCoordinator = {
  notifyMailbox(message: TeamMailboxRow): void {
    if (!message.from_member_id || !WAKE_MAILBOX_TYPES.has(message.type)) return
    const team = teamStore.get(message.team_id)
    const member = teamMemberStore.get(message.from_member_id)
    if (!team || !member || member.role === 'leader') return
    const task = message.task_id ? taskStore.get(message.task_id) : undefined
    const delayMs = message.task_id ? TASK_MAILBOX_WAKE_DELAY_MS : WAKE_DELAY_MS
    scheduleLeaderWake(team, member, buildLeaderWakePrompt({ team, member, message, task }), delayMs)
  },

  notifyTaskUpdated(task: TaskRow, actor?: { teamMemberId?: string }): void {
    if (!task.team_id || !actor?.teamMemberId || !WAKE_TASK_STATUSES.has(task.status)) return
    const team = teamStore.get(task.team_id)
    const member = teamMemberStore.get(actor.teamMemberId)
    if (!team || !member || member.role === 'leader') return
    scheduleLeaderWake(team, member, buildLeaderWakePrompt({ team, member, task }), WAKE_DELAY_MS)
  },
}

function scheduleLeaderWake(team: TeamRow, member: TeamMemberRow, prompt: string, delayMs: number): void {
  const leader = teamMemberStore.list(team.id).find((item) => item.role === 'leader')
  if (!leader) {
    log.warn({ teamId: team.id, memberId: member.id }, 'Team Leader missing; wake skipped')
    return
  }

  pendingByLeaderSession.set(leader.session_id, prompt)
  const existingTimer = wakeTimers.get(leader.session_id)
  if (existingTimer) clearTimeout(existingTimer)
  const timer = setTimeout(() => flushLeaderWake(leader.session_id), delayMs)
  timer.unref?.()
  wakeTimers.set(leader.session_id, timer)
  log.debug({ teamId: team.id, leaderSessionId: leader.session_id, delayMs }, 'Team Leader wake scheduled')
}

function flushLeaderWake(leaderSessionId: string): void {
  wakeTimers.delete(leaderSessionId)
  const prompt = pendingByLeaderSession.get(leaderSessionId)
  if (!prompt) return
  if (sessionManager.isPromptActive(leaderSessionId) || activeLeaderSessions.has(leaderSessionId)) {
    log.debug({ leaderSessionId }, 'Team Leader wake remains queued because session is active')
    return
  }
  pendingByLeaderSession.delete(leaderSessionId)
  sendWake(leaderSessionId, prompt)
}

function sendWake(leaderSessionId: string, prompt: string): void {
  activeLeaderSessions.add(leaderSessionId)
  void sessionManager.enqueuePrompt(leaderSessionId, prompt).catch((err: unknown) => {
    if (isActivePromptError(err)) {
      pendingByLeaderSession.set(leaderSessionId, prompt)
      log.debug({ leaderSessionId }, 'Team Leader wake queued after active session rejection')
      return
    }
    activeLeaderSessions.delete(leaderSessionId)
    log.error({ err, leaderSessionId }, 'Team Leader wake failed')
  })
}

function isActivePromptError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('当前会话正在生成中')
}
