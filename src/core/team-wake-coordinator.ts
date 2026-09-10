import { taskStore, type TaskRow } from '../store/tasks.js'
import { teamMemberStore, teamStore, type TeamMailboxRow, type TeamMemberRow, type TeamRow } from '../store/teams.js'
import { teamConversationStore } from '../store/team-conversations.js'
import { sessionStore } from '../store/sessions.js'
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
  notifyMailbox(message: TeamMailboxRow, sourceSessionId?: string): void {
    if (!message.from_member_id || !WAKE_MAILBOX_TYPES.has(message.type)) return
    const team = teamStore.get(message.team_id)
    const member = teamMemberStore.get(message.from_member_id)
    if (!team || !member || member.role === 'leader') return
    const task = message.task_id ? taskStore.get(message.task_id) : undefined
    const delayMs = message.task_id ? TASK_MAILBOX_WAKE_DELAY_MS : WAKE_DELAY_MS
    // 成员在哪条会话线干活，就唤醒那条线的 Leader（leader 格子 = 该线 master session）。
    const conversation = sourceSessionId ? teamConversationStore.getBySession(sourceSessionId) : undefined
    const preferredLeaderSessionId = conversation
      ? teamConversationStore.listMembers(conversation.id).find((entry) => teamMemberStore.get(entry.member_id)?.role === 'leader')?.session_id
      : undefined
    scheduleLeaderWake(team, member, buildLeaderWakePrompt({ team, member, message, task }), delayMs, preferredLeaderSessionId)
  },

  notifyTaskUpdated(task: TaskRow, actor?: { teamMemberId?: string }): void {
    if (!task.team_id || !actor?.teamMemberId || !WAKE_TASK_STATUSES.has(task.status)) return
    const team = teamStore.get(task.team_id)
    const member = teamMemberStore.get(actor.teamMemberId)
    if (!team || !member || member.role === 'leader') return
    // 任务记线：优先用创建任务时的来源会话反查会话线，唤醒该线的 Leader。
    const preferredLeaderSessionId = task.initiator_session_id
      ? leaderSessionIdForConversationOf(team.id, task.initiator_session_id)
      : undefined
    scheduleLeaderWake(team, member, buildLeaderWakePrompt({ team, member, task }), WAKE_DELAY_MS, preferredLeaderSessionId)
  },

  /**
   * 重启对账用：补发一条可能因进程重启丢失的邮箱唤醒。
   * 唤醒资格与 notifyMailbox 同口径（汇报类类型、非 Leader 成员）；只处理不绑任务的纯汇报，
   * 绑任务的在运行期会与任务状态更新合并成一次唤醒，重启后由任务对账（needs_input）覆盖。
   * 守卫：目标 Leader session 已有 pending 唤醒，或其 last_message_at 晚于汇报时间
   * （说明唤醒已发生过，或用户已亲自介入），都不重复唤醒。
   */
  recoverPendingWake(message: TeamMailboxRow): boolean {
    if (!message.from_member_id || message.task_id || !WAKE_MAILBOX_TYPES.has(message.type)) return false
    const team = teamStore.get(message.team_id)
    const member = teamMemberStore.get(message.from_member_id)
    if (!team || !member || member.role === 'leader') return false
    const leader = teamMemberStore.list(team.id).find((item) => item.role === 'leader')
    if (!leader) return false
    let leaderSessionId: string
    try {
      leaderSessionId = resolveWakeTargetSession(team, leader, member)
    } catch (err) {
      log.warn({ err, teamId: team.id, messageId: message.id }, 'Team wake recovery skipped: no resolvable leader session')
      return false
    }
    if (pendingByLeaderSession.has(leaderSessionId) || wakeTimers.has(leaderSessionId)) return false
    const leaderSession = sessionStore.get(leaderSessionId)
    if (leaderSession?.last_message_at && leaderSession.last_message_at > message.created_at) return false
    scheduleLeaderWake(team, member, buildLeaderWakePrompt({ team, member, message }), WAKE_DELAY_MS, leaderSessionId)
    log.info({ teamId: team.id, messageId: message.id, leaderSessionId }, 'Recovered pending Team Leader wake after restart')
    return true
  },
}

/** 解析某条会话线（通过线内任一 session 识别）的 Leader 格子 session，即该线 master。 */
function leaderSessionIdForConversationOf(teamId: string, conversationSessionId: string): string | undefined {
  const conversation = teamConversationStore.getBySession(conversationSessionId)
  if (!conversation || conversation.team_id !== teamId) return undefined
  return teamConversationStore.listMembers(conversation.id)
    .find((entry) => teamMemberStore.get(entry.member_id)?.role === 'leader')?.session_id ?? undefined
}

function scheduleLeaderWake(team: TeamRow, member: TeamMemberRow, prompt: string, delayMs: number, preferredLeaderSessionId?: string | null): void {
  const leader = teamMemberStore.list(team.id).find((item) => item.role === 'leader')
  if (!leader) {
    log.warn({ teamId: team.id, memberId: member.id }, 'Team Leader missing; wake skipped')
    return
  }

  const leaderSessionId = resolveWakeTargetSession(team, leader, member, preferredLeaderSessionId)
  pendingByLeaderSession.set(leaderSessionId, prompt)
  const existingTimer = wakeTimers.get(leaderSessionId)
  if (existingTimer) clearTimeout(existingTimer)
  const timer = setTimeout(() => flushLeaderWake(leaderSessionId), delayMs)
  timer.unref?.()
  wakeTimers.set(leaderSessionId, timer)
  log.debug({ teamId: team.id, leaderSessionId, delayMs }, 'Team Leader wake scheduled')
}

/**
 * 唤醒目标解析链（全部优先落在"会话线"维度，避免唤醒跑进不属于任何线的孤儿 session）：
 * 1) 调用方显式给出的线内 Leader session；
 * 2) 成员首线格子反查出的线 → 该线 Leader 格子；
 * 3) 团队最近一条活跃会话线的 master session；
 * 4) 兼容兜底：team_members.leader.session_id（仅存量的无会话线团队会走到）。
 */
function resolveWakeTargetSession(team: TeamRow, leader: TeamMemberRow, member: TeamMemberRow, preferredLeaderSessionId?: string | null): string {
  if (preferredLeaderSessionId) return preferredLeaderSessionId
  const viaMember = member.session_id ? teamConversationStore.getBySession(member.session_id) : undefined
  if (viaMember) {
    const leaderSessionId = leaderSessionIdForConversationOf(team.id, member.session_id as string)
    if (leaderSessionId) return leaderSessionId
  }
  const latestActive = teamConversationStore.list(team.id).find((conversation) => conversation.status === 'active')
  if (latestActive) return latestActive.master_session_id
  if (leader.session_id) {
    log.warn({ teamId: team.id, leaderSessionId: leader.session_id }, 'Team Leader wake fell back to member-bound session (no active conversation)')
    return leader.session_id
  }
  throw new Error(`Team ${team.id} 没有可唤醒的 Leader 会话`)
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

// 唤醒 prompt 是平台自动触发的,不是用户说的话;带身份落库,避免前端把它渲染成"你"的用户气泡。
const WAKE_PROMPT_OPTIONS = { senderRole: 'team-system', senderName: '系统' } as const

function sendWake(leaderSessionId: string, prompt: string): void {
  activeLeaderSessions.add(leaderSessionId)
  void sessionManager.enqueuePrompt(leaderSessionId, prompt, undefined, { ...WAKE_PROMPT_OPTIONS }).catch((err: unknown) => {
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
