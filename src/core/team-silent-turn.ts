/**
 * 静默回合兜底唤醒（P0b）：成员在"团队派发 / 用户定向"回合结束后，整轮没有给 Leader 发过任何汇报时，
 * 系统兜底唤醒 Leader，并把**成员最后回复的原文**一并带过去（正常结束 / 出错 / 被中断三档）。
 *
 * 设计要点（方案文档 §2，实施时不得改动的三处硬约束）：
 * 1) 挂载点是 session:committed_done —— session:done 触发时最终文本还没落库，会读到空串 / running 快照；
 * 2) 时间窗起点 = 回合 human 消息时间戳（与回合开始同源），不能用回合结束时刻（否则回合内的正常汇报被误判为没汇报）；
 * 3) 合并桶必须**追加**语义 —— 走 teamWakeCoordinator.notifySilentTurn（内部 appendLeaderWake），
 *    沿用现有覆盖语义会在"同一窗口多成员静默"时丢报。
 *
 * 防 ping-pong 三道锁：来源锁（只认 team-assignment / team-directed 回合）+ 无新进展抑制（60min）+ 每成员每小时频次帽。
 * 崩溃路径（无任何回合结束事件）不在本模块覆盖范围，交 P2 周期扫描兜底（方案 §2.2 档④）。
 */
import { events, type AppEvents } from './events.js'
import { createChildLogger } from './logger.js'
import { messageStore } from '../store/sessions.js'
import { isWakeEligibleMailbox, teamMailboxStore, teamMemberStore, teamStore } from '../store/teams.js'
import { taskEventStore, taskStore, type TaskEventRow } from '../store/tasks.js'
import { teamConversationStore } from '../store/team-conversations.js'
import { turnProcessItemStore } from '../store/turn-process-items.js'
import { teamWakeCoordinator, WAKE_TASK_STATUSES } from './team-wake-coordinator.js'
import { buildSilentTurnWakePrompt, truncateForWake } from './team-prompts.js'

const log = createChildLogger('team-silent-turn')

/** 来源锁：只有团队派发 / 用户定向回合参与判定；系统唤醒回合（team-system/system/agent/autonomy/secretary…）天然排除。 */
const TEAM_TURN_SENDER_ROLES = new Set(['team-assignment', 'team-directed'])
/**
 * 任务事件里"可能构成汇报动作"的类型（任务行没有 updated_at，事件表是唯一来源）。
 * 注意：类型命中还不够 —— 只有 to_status 真正唤醒过 Leader 的事件才算"已汇报"（P0-C′，见 isTaskWakeReportEvent）。
 */
const TASK_PROGRESS_EVENT_TYPES = new Set(['updated', 'manual_status_change', 'assigned_agent'])
const TERMINAL_TASK_STATUSES = new Set(['completed', 'cancelled'])

const HOUR_MS = 60 * 60_000
const WAKE_DELAY_MS = readNumberEnv('TEAM_SILENT_TURN_WAKE_DELAY_MS', 15_000)
const MAX_NOTICES_PER_HOUR = readNumberEnv('TEAM_SILENT_TURN_MAX_PER_HOUR', 6)
const NO_PROGRESS_SUPPRESS_MS = readNumberEnv('TEAM_SILENT_TURN_SUPPRESS_MS', HOUR_MS)

/** 每成员最后一次静默提醒时刻（无新进展抑制用）；只在内存，重启清零（可接受，见方案 §2.6 风险 6）。 */
const lastNoticeAt = new Map<string, number>()
/** 每成员最近 1 小时的提醒时刻（频次帽用）；取用时就地裁剪过期项，避免无界增长。 */
const noticeTimestamps = new Map<string, number[]>()

events.on('session:committed_done', (ev) => {
  try {
    handleSilentTurn(ev)
  } catch (err: unknown) {
    log.error({ err, sessionId: ev.sessionId }, 'Team silent-turn wake evaluation failed')
  }
})

function handleSilentTurn(ev: AppEvents['session:committed_done']): void {
  // ── Step 0 · 身份过滤：格子/主会话反查成员，leader 自己的回合与已移除成员不触发；会话必须属于某个活跃会话线
  const member = teamMemberStore.getBySession(ev.sessionId)
  if (!member || member.role === 'leader' || member.status !== 'active') return
  const conversation = teamConversationStore.getBySession(ev.sessionId)
  if (!conversation || conversation.team_id !== member.team_id) return
  const team = teamStore.get(member.team_id)
  if (!team || team.status !== 'active' || team.archived_at) return

  // ── Step 1 · 来源锁：本回合最后一条 human 消息的署名必须是团队派发 / 用户定向
  const human = messageStore.latestHumanMessage(ev.sessionId)
  if (!human || !TEAM_TURN_SENDER_ROLES.has(human.sender_role ?? '')) return
  const turnStartedAtIso = human.timestamp

  // ── Step 2 · 汇报判定：时间窗起点 = 回合开始（human 消息时间戳）
  if (hasMemberReportedSince(team.id, member.id, turnStartedAtIso)) return

  // ── Step 3 · 降噪：只保留"抑制窗口 + 频次帽"两道丢弃闸
  // P0-B：原先的 pendingTasks 硬门槛已移除 —— 任务没指派（Leader 建任务漏传 assigneeMemberId）时
  // pendingTasks=0 会让兜底连成员回复原文都不取就 return，正是 2026-09-17 glm53 汇报丢失的直接死点。
  // pendingTasks 现在只作 prompt 富化字段（Task 行），不参与"兜不兜"的判定。
  const pendingTasks = taskStore
    .listByTeam(team.id)
    .filter((task) => task.assignee_member_id === member.id && !TERMINAL_TASK_STATUSES.has(task.status))
  const now = Date.now()
  if (isSuppressedByRecentNotice(member.id, team.id, now)) return
  if (!consumeHourlyQuota(member.id, now)) return

  // ── Step 4 · 组装 + 入桶（追加语义）
  const replyText = truncateForWake(messageStore.latestAgentMessage(ev.sessionId)?.content)
  const fallbackActionTitle = replyText ? null : lastProcessItemTitle(ev.messageId)
  const prompt = buildSilentTurnWakePrompt({
    team,
    member,
    conversation: { id: conversation.id, title: conversation.title },
    trigger: ev.stopReason ?? 'end_turn',
    error: ev.error ?? null,
    replyText,
    fallbackActionTitle,
    dispatchedAtIso: turnStartedAtIso,
    pendingTasks: pendingTasks.map((task) => ({ id: task.id, title: task.title, status: task.status })),
  })
  lastNoticeAt.set(member.id, now)
  teamWakeCoordinator.notifySilentTurn({
    teamId: team.id,
    memberId: member.id,
    sessionId: ev.sessionId,
    prompt,
    delayMs: WAKE_DELAY_MS,
  })
  log.info(
    {
      teamId: team.id, memberId: member.id, sessionId: ev.sessionId,
      trigger: ev.stopReason ?? 'end_turn', taskCount: pendingTasks.length,
    },
    'Team silent-turn wake dispatched',
  )
}

/** 时间窗内该成员名下任务的事件（两个判定共用同一份取数）。 */
function memberTaskEventsSince(teamId: string, memberId: string, sinceIso: string): TaskEventRow[] {
  const taskIds = taskStore.listByTeam(teamId)
    .filter((task) => task.assignee_member_id === memberId)
    .map((task) => task.id)
  return taskEventStore.listByTaskIdsSince(taskIds, sinceIso)
}

/**
 * Step 2 口径（P0-C′）：时间窗内该成员是否**报告过**——
 * 唤醒级 mailbox，或真正唤醒过 Leader 的任务状态事件。
 */
function hasMemberReportedSince(teamId: string, memberId: string, sinceIso: string): boolean {
  const mailbox = teamMailboxStore.listByMemberSince(teamId, memberId, sinceIso)
  if (mailbox.some((message) => isWakeEligibleMailbox(message))) return true
  return memberTaskEventsSince(teamId, memberId, sinceIso).some((event) => isTaskWakeReportEvent(event))
}

/**
 * 锁 2 口径：时间窗内是否有任何进展（含 running 等中间态任务事件）。
 * 只用于解除"无新进展抑制"，**不参与"已汇报"判定** —— 中间态更新能证明成员还在干活（不该反复催），
 * 但它没有唤醒过 Leader（不能当作已汇报，见 isTaskWakeReportEvent）。
 */
function hasNewProgressSince(teamId: string, memberId: string, sinceIso: string): boolean {
  const mailbox = teamMailboxStore.listByMemberSince(teamId, memberId, sinceIso)
  if (mailbox.some((message) => isWakeEligibleMailbox(message))) return true
  return memberTaskEventsSince(teamId, memberId, sinceIso).some((event) => TASK_PROGRESS_EVENT_TYPES.has(event.type))
}

/**
 * P0-C′：任务事件算不算"已汇报"。
 * 只有 to_status ∈ WAKE_TASK_STATUSES（completed / needs_input，与 team-wake-coordinator 同源）才算 ——
 * 这类更新本身会唤醒 Leader，兜底再发一次属于重复通知。
 * 中间态（running→running 的 stage-only 更新等）不唤醒 Leader，若在"已汇报"判定里算数会造成
 * "兜底被跳过 + 唤醒没发生"的双重静默（2026-09-17 评审 #4，生产可达）。
 */
function isTaskWakeReportEvent(event: Pick<TaskEventRow, 'type' | 'payload_json'>): boolean {
  if (!TASK_PROGRESS_EVENT_TYPES.has(event.type)) return false
  const toStatus = readEventToStatus(event.payload_json)
  return toStatus !== null && WAKE_TASK_STATUSES.has(toStatus)
}

function readEventToStatus(payloadJson: string): string | null {
  try {
    const payload = JSON.parse(payloadJson) as { to_status?: unknown }
    return typeof payload.to_status === 'string' ? payload.to_status : null
  } catch {
    return null
  }
}

/** 锁 2：上次提醒后 60 分钟内、且期间没有任何新进展 → 不再提醒（防"唤醒→重派→又静默→再唤醒"循环）。 */
function isSuppressedByRecentNotice(memberId: string, teamId: string, now: number): boolean {
  const last = lastNoticeAt.get(memberId)
  if (last === undefined || now - last >= NO_PROGRESS_SUPPRESS_MS) return false
  return !hasNewProgressSince(teamId, memberId, new Date(last).toISOString())
}

/** 锁 3：每成员每小时上限（默认 6，0 表示关闭本兜底）。 */
function consumeHourlyQuota(memberId: string, now: number): boolean {
  if (MAX_NOTICES_PER_HOUR <= 0) return false
  const recent = (noticeTimestamps.get(memberId) ?? []).filter((stamp) => now - stamp < HOUR_MS)
  if (recent.length >= MAX_NOTICES_PER_HOUR) {
    noticeTimestamps.set(memberId, recent)
    log.info({ memberId, count: recent.length, limit: MAX_NOTICES_PER_HOUR }, 'Team silent-turn wake dropped by hourly quota')
    return false
  }
  recent.push(now)
  noticeTimestamps.set(memberId, recent)
  return true
}

function lastProcessItemTitle(messageId: string): string | null {
  const items = turnProcessItemStore.list(messageId)
  const last = items.at(-1)
  return last?.title ?? null
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}
