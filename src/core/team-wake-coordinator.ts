import { taskStore, type TaskRow } from '../store/tasks.js'
import {
  isWakeEligibleMailbox,
  teamMailboxStore,
  teamMemberStore,
  teamStore,
  type MailboxLineFilter,
  type TeamMailboxRow,
  type TeamMemberRow,
  type TeamRow,
} from '../store/teams.js'
import { defaultLine, taskLine } from './team-line-scope.js'
import { teamConversationStore } from '../store/team-conversations.js'
import { sessionStore } from '../store/sessions.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { sessionManager } from './sessions.js'
import { buildLeaderWakePrompt, formatWakeDuration, truncateForWake, type WakeTriggerSnapshot } from './team-prompts.js'

const log = createChildLogger('team-wake')
const WAKE_MAILBOX_TYPES = new Set(['report', 'result', 'question', 'blocked'])
const WAKE_TASK_STATUSES = new Set(['completed', 'needs_input'])
const WAKE_DELAY_MS = 2_000
const TASK_MAILBOX_WAKE_DELAY_MS = 15_000
/** 同窗待发唤醒总长上限：邮件风暴时截断追加，避免把唤醒 prompt 撑爆。 */
const WAKE_PENDING_MAX_CHARS = 40_000
/** 同线已投递标记的生效窗口：窗口内同一封邮件/同一任务状态不再重复唤醒（防"翻旧账"）。 */
const WAKE_DEDUPE_TTL_MS = 120_000
/** 快照里每条邮件摘要的截断长度。 */
const WAKE_SNAPSHOT_MAIL_MAX_CHARS = 160
const activeLeaderSessions = new Set<string>()
/**
 * 覆盖层：既有入口（mailbox / 任务 / 派发失败 / 重启恢复）共用。
 * 语义为**拼接**（v3 修正）：单槽覆盖会让"任务唤醒（2s）后到"整体替换掉"任务邮件唤醒（15s）"的正文——
 * 本案 3 封被吞即此（见 docs/analysis/2026-09-17-wakeup-routing-*.md）。改为去重拼接后任一入口先到都不丢。
 */
const pendingByLeaderSession = new Map<string, string>()
/**
 * 追加层：静默回合兜底通知专用，与覆盖层分层存放。
 * 单一覆盖层会让"静默通知先入桶、1 秒后 mailbox 汇报到达"时整体替换掉静默内容（永久丢报）；
 * 分层后任一入口覆盖都不影响静默内容，flush 时两层拼接、一起发、一起清。
 */
const appendedByLeaderSession = new Map<string, string>()
const wakeTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** 每个目标会话已排定的 flush 绝对时刻（最早截止时间优先，见 armWakeTimer）。 */
const wakeDeadlines = new Map<string, number>()
/** 同线已投递标记：`${leaderSessionId}:${签名}` → 投递时刻。轻量内存态，重启即清空。 */
const deliveredWakeSignatures = new Map<string, number>()
const DELIVERED_WAKE_MAX = 500

function hasPendingWake(leaderSessionId: string): boolean {
  return pendingByLeaderSession.has(leaderSessionId) || appendedByLeaderSession.has(leaderSessionId)
}

/** 取出并清空两层待发内容，拼接成一条（覆盖层在前、追加层在后——不保证严格时间序：
 *  静默先到、覆盖后到时覆盖层仍排在前，两段内容语义自明，leader 可自行分辨先后）。 */
function takePendingWake(leaderSessionId: string): string | undefined {
  const overwritten = pendingByLeaderSession.get(leaderSessionId)
  const appended = appendedByLeaderSession.get(leaderSessionId)
  pendingByLeaderSession.delete(leaderSessionId)
  appendedByLeaderSession.delete(leaderSessionId)
  const parts = [overwritten, appended].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

/** 同线已投递标记（轻量、有窗口）：窗口内重复的唤醒签名直接跳过，避免同一封邮件被反复翻出来。 */
function isWakeDelivered(leaderSessionId: string, signature: string): boolean {
  const at = deliveredWakeSignatures.get(`${leaderSessionId}:${signature}`)
  return at !== undefined && Date.now() - at < WAKE_DEDUPE_TTL_MS
}

function markWakeDelivered(leaderSessionId: string, signature: string): void {
  deliveredWakeSignatures.set(`${leaderSessionId}:${signature}`, Date.now())
  if (deliveredWakeSignatures.size > DELIVERED_WAKE_MAX) {
    const oldest = deliveredWakeSignatures.keys().next().value
    if (oldest !== undefined) deliveredWakeSignatures.delete(oldest)
  }
}

/** 入桶（拼接 + 去重 + 长度上限）；同一条内容重复入桶不重复拼接。 */
function appendToPending(map: Map<string, string>, leaderSessionId: string, prompt: string): void {
  const existing = map.get(leaderSessionId)
  if (!existing) {
    map.set(leaderSessionId, prompt)
    return
  }
  if (existing.includes(prompt)) return
  const remaining = WAKE_PENDING_MAX_CHARS - existing.length
  if (remaining <= 0) {
    log.warn({ leaderSessionId, length: existing.length }, 'Team Leader wake pending content exceeded cap; extra content dropped')
    return
  }
  const next = prompt.length > remaining ? `${prompt.slice(0, remaining)}\n…（本次唤醒内容过长，已截断）` : prompt
  map.set(leaderSessionId, `${existing}\n\n${next}`)
}

/**
 * 排定 flush 定时器：**最早截止时间优先**——新到内容带着更早的截止时间时提前 flush（2s 的邮件唤醒
 * 不必等 15s 的静默窗口），更晚的截止时间不推迟已有排期（连续通知不会把合并窗口无限延后）。
 */
function armWakeTimer(leaderSessionId: string, delayMs: number): void {
  const deadline = Date.now() + delayMs
  const existingDeadline = wakeDeadlines.get(leaderSessionId)
  if (existingDeadline !== undefined && existingDeadline <= deadline) return
  const existingTimer = wakeTimers.get(leaderSessionId)
  if (existingTimer) clearTimeout(existingTimer)
  const timer = setTimeout(() => flushLeaderWake(leaderSessionId), Math.max(0, deadline - Date.now()))
  timer.unref?.()
  wakeTimers.set(leaderSessionId, timer)
  wakeDeadlines.set(leaderSessionId, deadline)
}

events.on('session:activity', (ev) => {
  if (ev.state === 'idle') resumePendingWake(ev.sessionId)
})

function resumePendingWake(sessionId: string): void {
  if (!hasPendingWake(sessionId) || wakeTimers.has(sessionId)) return
  armWakeTimer(sessionId, WAKE_DELAY_MS)
}

events.on('session:manual-prompt-started', (ev) => {
  if (!hasPendingWake(ev.sessionId)) return
  const existingTimer = wakeTimers.get(ev.sessionId)
  if (existingTimer) {
    clearTimeout(existingTimer)
    wakeTimers.delete(ev.sessionId)
    wakeDeadlines.delete(ev.sessionId)
  }
  log.debug({ leaderSessionId: ev.sessionId }, 'Team Leader wake paused behind manual prompt')
})

export const teamWakeCoordinator = {
  notifyDispatchFailed(input: { teamId: string; memberId: string; sessionId: string; taskId?: string; error: string }): void {
    const team = teamStore.get(input.teamId)
    const member = teamMemberStore.get(input.memberId)
    if (!team || !member || member.team_id !== team.id || member.role === 'leader') return
    const task = input.taskId ? taskStore.get(input.taskId) : undefined
    const leaderSessionId = leaderSessionIdForConversationOf(team.id, input.sessionId)
    scheduleLeaderWake(team, member, buildLeaderWakePrompt({
      team, member, task, dispatchError: input.error,
    }), WAKE_DELAY_MS, leaderSessionId, { reason: 'dispatch-failed' })
    log.info({ teamId: team.id, memberId: member.id, sessionId: input.sessionId, taskId: input.taskId, leaderSessionId }, 'Team dispatch failure wake scheduled')
  },

  notifyMailbox(message: TeamMailboxRow, sourceSessionId?: string): void {
    if (!message.from_member_id || !isWakeEligibleMailbox(message)) return
    const team = teamStore.get(message.team_id)
    const member = teamMemberStore.get(message.from_member_id)
    if (!team || !member || member.role === 'leader') return
    const task = message.task_id ? taskStore.get(message.task_id) : undefined
    const delayMs = message.task_id ? TASK_MAILBOX_WAKE_DELAY_MS : WAKE_DELAY_MS
    // 邮件归属哪条线就唤醒哪条线的 Leader（leader 格子 = 该线 master session）：
    // 优先用写入时钉死的 conversation_id（migration 075 强制归属），缺失时按来源会话反查，
    // 两者都没有时交给 scheduleLeaderWake 的解析链兜底（存量无归属数据）。
    const preferredLeaderSessionId = (message.conversation_id
      ? leaderSessionIdForConversationId(team.id, message.conversation_id)
      : undefined)
      ?? (sourceSessionId ? leaderSessionIdForConversationOf(team.id, sourceSessionId) : undefined)
    scheduleLeaderWake(team, member, buildLeaderWakePrompt({
      team, member, message, task, trigger: buildWakeTriggerSnapshot({ team, member, message, task }),
    }), delayMs, preferredLeaderSessionId, { reason: 'mailbox', signature: `mailbox:${message.id}` })
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
    scheduleLeaderWake(team, member, buildLeaderWakePrompt({
      team, member, task, trigger: buildWakeTriggerSnapshot({ team, member, task }),
    }), WAKE_DELAY_MS, preferredLeaderSessionId, { reason: 'task', signature: `task:${task.id}:${task.status}` })
  },

  /**
   * 静默回合兜底唤醒（P0b）：成员回合结束但整轮没汇报时，由 team-silent-turn 判定后调这里入桶。
   * 与其余唤醒来源不同，本入口用**追加**语义入桶：同一合并窗口内多个成员的静默通知必须全部保留，
   * 沿用 scheduleLeaderWake 的覆盖语义会丢报（见 appendLeaderWake 注释）。
   */
  notifySilentTurn(input: { teamId: string; memberId: string; sessionId: string; prompt: string; delayMs?: number }): void {
    const team = teamStore.get(input.teamId)
    const member = teamMemberStore.get(input.memberId)
    if (!team || !member || member.team_id !== team.id || member.role === 'leader') return
    const leaderSessionId = leaderSessionIdForConversationOf(team.id, input.sessionId)
    appendLeaderWake(team, member, input.prompt, input.delayMs ?? WAKE_DELAY_MS, leaderSessionId, { reason: 'silent-turn' })
    log.info(
      { teamId: team.id, memberId: member.id, sessionId: input.sessionId, leaderSessionId },
      'Team silent-turn wake scheduled',
    )
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
    let target: WakeTarget
    try {
      target = resolveWakeTargetSession(team, leader, member, leaderSessionIdFromMessage(team, message))
    } catch (err) {
      log.warn({ err, teamId: team.id, messageId: message.id }, 'Team wake recovery skipped: no resolvable leader session')
      return false
    }
    if (hasPendingWake(target.sessionId) || wakeTimers.has(target.sessionId)) return false
    const leaderSession = sessionStore.get(target.sessionId)
    if (leaderSession?.last_message_at && leaderSession.last_message_at > message.created_at) return false
    const scheduled = scheduleLeaderWake(team, member, buildLeaderWakePrompt({
      team, member, message, trigger: buildWakeTriggerSnapshot({ team, member, message }),
    }), WAKE_DELAY_MS, target.sessionId, { reason: 'recovery', signature: `mailbox:${message.id}` })
    if (scheduled) log.info({ teamId: team.id, messageId: message.id, leaderSessionId: target.sessionId }, 'Recovered pending Team Leader wake after restart')
    return scheduled
  },
}

/** 邮件写入时钉死的线（migration 075）→ 该线 Leader 格子 session。 */
function leaderSessionIdFromMessage(team: TeamRow, message: TeamMailboxRow): string | undefined {
  return message.conversation_id ? leaderSessionIdForConversationId(team.id, message.conversation_id) : undefined
}

/** 唤醒 prompt 末尾"触发内容快照"：任务状态 + 相关邮件摘要。
 *  与正文有重叠，但位置在**末尾**：被合并/延迟的唤醒里，Master 仍能从尾段看到"为什么被叫醒"。
 *  邮件摘要按**触发邮件所在线**过滤（F2）：同一 taskId 被两线引用时，只给本线邮件；
 *  任务状态行（taskLines）保留——它是"为什么被叫醒"的必要信息，不属于任何线的私密内容。 */
function buildWakeTriggerSnapshot(input: {
  team: TeamRow
  member: TeamMemberRow
  message?: TeamMailboxRow
  task?: TaskRow
}): WakeTriggerSnapshot {
  const now = Date.now()
  const taskLines = input.task
    ? [`任务：${input.task.title} (${input.task.id}) · 状态 ${input.task.status}${input.task.stage ? ` · 阶段 ${input.task.stage}` : ''}`]
    : []
  const related = input.task
    ? teamMailboxStore.listByTask(input.task.id, 3, snapshotLineFilter(input.team.id, input.message, input.task))
    : (input.message ? [input.message] : [])
  return { taskLines, mailboxLines: related.map((message) => formatWakeMailboxLine(message, now)) }
}

/** 快照要取的线：邮件触发的唤醒取该邮件所在线（遗留 NULL 行按默认线，与读取口径一致）；
 *  任务触发的唤醒取任务所在线（无来源会话的历史任务同样按默认线）。无线可归 → undefined（不追加邮件摘要）。 */
function snapshotLineFilter(teamId: string, message?: TeamMailboxRow, task?: TaskRow): MailboxLineFilter | undefined {
  const defaultConversationId = defaultLine(teamId)?.id ?? null
  const conversationId = (message ? message.conversation_id ?? defaultConversationId : undefined)
    ?? (task ? taskLine(teamId, task.id)?.id : undefined)
    ?? defaultConversationId
  if (!conversationId) return undefined
  return { conversationId, defaultConversationId }
}

function formatWakeMailboxLine(message: TeamMailboxRow, now: number): string {
  const from = message.from_member_id ? teamMemberStore.get(message.from_member_id)?.name : undefined
  const age = formatWakeDuration(Math.max(0, now - Date.parse(message.created_at)))
  const snippet = (truncateForWake(message.content, WAKE_SNAPSHOT_MAIL_MAX_CHARS) ?? '（空）').replace(/\n+/g, ' ')
  return `- ${message.id} ${message.type}${from ? ` · 来自 ${from}` : ''} · ${age}前 · ${snippet}`
}

/**
 * 唤醒目标解析链（全部优先落在"会话线"维度，避免唤醒跑进不属于任何线的孤儿 session）：
 * 1) 调用方显式给出的线内 Leader session；
 * 2) 成员首线格子反查出的线 → 该线 Leader 格子；
 * 3) 团队最近一条活跃会话线的 master session；
 * 4) 兼容兜底：team_members.leader.session_id（仅存量的无会话线团队会走到）。
 * 返回命中的层级（via），供 "Team Leader wake scheduled" 日志与线上排查用。
 */
function resolveWakeTargetSession(team: TeamRow, leader: TeamMemberRow, member: TeamMemberRow, preferredLeaderSessionId?: string | null): WakeTarget {
  if (preferredLeaderSessionId) return { sessionId: preferredLeaderSessionId, via: 'preferred' }
  const viaMember = member.session_id ? teamConversationStore.getBySession(member.session_id) : undefined
  if (viaMember) {
    const leaderSessionId = leaderSessionIdForConversationOf(team.id, member.session_id as string)
    if (leaderSessionId) return { sessionId: leaderSessionId, via: 'member-line' }
  }
  const latestActive = teamConversationStore.list(team.id).find((conversation) => conversation.status === 'active')
  if (latestActive) return { sessionId: latestActive.master_session_id, via: 'latest-active' }
  if (leader.session_id) {
    log.warn({ teamId: team.id, leaderSessionId: leader.session_id }, 'Team Leader wake fell back to member-bound session (no active conversation)')
    return { sessionId: leader.session_id, via: 'member-bound' }
  }
  throw new Error(`Team ${team.id} 没有可唤醒的 Leader 会话`)
}

function flushLeaderWake(leaderSessionId: string): void {
  wakeTimers.delete(leaderSessionId)
  wakeDeadlines.delete(leaderSessionId)
  if (!hasPendingWake(leaderSessionId)) return
  if (sessionManager.isPromptActive(leaderSessionId) || activeLeaderSessions.has(leaderSessionId)) {
    log.debug({ leaderSessionId }, 'Team Leader wake remains queued because session is active')
    return
  }
  const prompt = takePendingWake(leaderSessionId)
  if (!prompt) return
  sendWake(leaderSessionId, prompt)
}

/** 唤醒目标解析结果：目标会话 + 命中层级（日志/排查用）。 */
interface WakeTarget {
  sessionId: string
  via: 'preferred' | 'member-line' | 'latest-active' | 'member-bound'
}

/** 调用方来源（日志用）：哪条链路叫醒了 Leader。 */
type WakeReason = 'mailbox' | 'task' | 'dispatch-failed' | 'recovery' | 'silent-turn'

interface WakeMeta {
  reason: WakeReason
  /** 同线已投递标记的签名（同线去重，防翻旧账）；静默回合等天然按回合去重的入口不传。 */
  signature?: string
}

/** 某条会话线（按线 id）的 Leader 格子 session，即该线 master。 */
function leaderSessionIdForConversationId(teamId: string, conversationId: string): string | undefined {
  const conversation = teamConversationStore.get(conversationId)
  if (!conversation || conversation.team_id !== teamId || conversation.status !== 'active') return undefined
  return teamConversationStore.listMembers(conversation.id)
    .find((entry) => teamMemberStore.get(entry.member_id)?.role === 'leader')?.session_id ?? undefined
}

/** 解析某条会话线（通过线内任一 session 识别）的 Leader 格子 session。 */
function leaderSessionIdForConversationOf(teamId: string, conversationSessionId: string): string | undefined {
  const conversation = teamConversationStore.getBySession(conversationSessionId)
  if (!conversation || conversation.team_id !== teamId) return undefined
  return leaderSessionIdForConversationId(teamId, conversation.id)
}

/**
 * 入桶（拼接语义）+ 排定最早截止时间的 flush；返回是否真的入桶了。
 * 同一签名在窗口内已投递过 → 跳过（同线去重）。
 */
function scheduleLeaderWake(
  team: TeamRow,
  member: TeamMemberRow,
  prompt: string,
  delayMs: number,
  preferredLeaderSessionId?: string | null,
  meta: WakeMeta = { reason: 'mailbox' },
): boolean {
  const leader = teamMemberStore.list(team.id).find((item) => item.role === 'leader')
  if (!leader) {
    log.warn({ teamId: team.id, memberId: member.id }, 'Team Leader missing; wake skipped')
    return false
  }

  const target = resolveWakeTargetSession(team, leader, member, preferredLeaderSessionId)
  if (meta.signature && isWakeDelivered(target.sessionId, meta.signature)) {
    log.info(
      { teamId: team.id, reason: meta.reason, signature: meta.signature, leaderSessionId: target.sessionId },
      'Team Leader wake skipped: already delivered in this window',
    )
    return false
  }
  appendToPending(pendingByLeaderSession, target.sessionId, prompt)
  armWakeTimer(target.sessionId, delayMs)
  if (meta.signature) markWakeDelivered(target.sessionId, meta.signature)
  log.info(
    { teamId: team.id, reason: meta.reason, via: target.via, leaderSessionId: target.sessionId, delayMs },
    'Team Leader wake scheduled',
  )
  return true
}

/**
 * 追加语义入桶：合并窗口内该 Leader 会话已有待发唤醒时**拼接**内容而不是覆盖。
 * 静默通知可能在同一窗口内来自多个成员（或与既有唤醒并发），覆盖会丢报；
 * 定时器按"最早截止时间"排定，不因追加而无限延后。
 */
function appendLeaderWake(team: TeamRow, member: TeamMemberRow, prompt: string, delayMs: number, preferredLeaderSessionId?: string | null, meta: WakeMeta = { reason: 'silent-turn' }): void {
  const leader = teamMemberStore.list(team.id).find((item) => item.role === 'leader')
  if (!leader) {
    log.warn({ teamId: team.id, memberId: member.id }, 'Team Leader missing; wake skipped')
    return
  }
  const target = resolveWakeTargetSession(team, leader, member, preferredLeaderSessionId)
  appendToPending(appendedByLeaderSession, target.sessionId, prompt)
  armWakeTimer(target.sessionId, delayMs)
  log.info(
    { teamId: team.id, reason: meta.reason, via: target.via, leaderSessionId: target.sessionId, delayMs },
    'Team Leader wake scheduled',
  )
}

// 唤醒 prompt 是平台自动触发的,不是用户说的话;带身份落库,避免前端把它渲染成"你"的用户气泡。
const WAKE_PROMPT_OPTIONS = { senderRole: 'team-system', senderName: '系统' } as const

function sendWake(leaderSessionId: string, prompt: string): void {
  activeLeaderSessions.add(leaderSessionId)
  void sessionManager.enqueuePrompt(leaderSessionId, prompt, undefined, { ...WAKE_PROMPT_OPTIONS }).catch((err: unknown) => {
    log.error({ err, leaderSessionId }, 'Team Leader wake failed')
  }).finally(() => {
    activeLeaderSessions.delete(leaderSessionId)
    resumePendingWake(leaderSessionId)
  })
}
