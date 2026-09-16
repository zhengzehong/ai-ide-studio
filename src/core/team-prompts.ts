import type { TaskRow } from '../store/tasks.js'
import type { TeamMailboxRow, TeamMemberRow, TeamRow } from '../store/teams.js'

const TEAM_LEADER_PROMPT_MARKER = 'Team Leader 协作规则'

export function buildTeamLeaderPrompt(content: string): string {
  if (isTeamLeaderPrompt(content)) return content
  return [
    TEAM_LEADER_PROMPT_MARKER,
    '- 调用 team.member.message 派活后，不要等待成员、不要使用 sleep、不要轮询，也不要运行终端 sleep 命令。',
    '- 派活后请结束本轮；系统会在成员通过 mailbox 汇报或更新任务状态时自动唤醒你。',
    '- 被唤醒后再使用 team.mailbox.list / team.task.list 查看最新状态，并决定总结或继续派发。',
    '',
    '用户请求：',
    content,
  ].join('\n')
}

export function isTeamLeaderPrompt(content: string): boolean {
  return content.includes(TEAM_LEADER_PROMPT_MARKER)
}

export function buildTeamMemberPrompt(input: {
  team: TeamRow
  member: TeamMemberRow
  content: string
  taskId?: string
  /** true=用户在团队线里指名发给该成员（绕过 Master 编排）；派发话术随之改为「用户直接发给你」。 */
  directed?: boolean
}): string {
  return [
    '你正在作为 AI IDE Studio Team 成员执行一次异步协作任务。',
    `Team: ${input.team.name} (${input.team.id})`,
    `Member: ${input.member.name} (${input.member.id})`,
    input.taskId ? `Task: ${input.taskId}` : undefined,
    '',
    ...(input.directed
      ? [
        '来源：这条消息由**用户**在团队会话线里直接发给你（定向消息，绕过 Master 编排）。',
        '协作规则：',
        '- 只处理用户本次直接发给你的内容，不要自行扩展范围。',
        '- 需要汇报或提问时使用 team.mailbox.send；Master 不会自动看到这条消息的上下文，重要结论请落 mailbox。',
        '- 禁止等待 Leader、禁止 sleep、禁止轮询；提交汇报后结束本轮。',
        '',
        '用户消息：',
      ]
      : [
        '协作规则：',
        '- 只处理本次派发给你的工作，不要自行扩展团队范围。',
        '- 完成、遇到阻塞或需要提问时，必须使用 team.mailbox.send 汇报。',
        '- 如果本次包含 Task ID，只能使用 team.task.update 更新分配给自己的任务状态或阶段。',
        '- 不要填写或伪造 fromMemberId，系统会使用当前成员身份。',
        '- 禁止等待 Leader、禁止 sleep、禁止轮询；提交汇报后结束本轮。',
        '',
        'Leader 派发内容：',
      ]),
    input.content,
  ]
    .filter((item): item is string => typeof item === 'string')
    .join('\n')
}

export function buildLeaderWakePrompt(input: {
  team: TeamRow
  member: TeamMemberRow
  message?: TeamMailboxRow
  task?: TaskRow
  dispatchError?: string
}): string {
  const lines = [
    input.dispatchError ? '系统通知：Team 成员派发失败，需要你处理。' : '系统通知：Team 成员有新的异步进展。',
    `Team: ${input.team.name} (${input.team.id})`,
    `Member: ${input.member.name} (${input.member.id})`,
  ]

  if (input.dispatchError) lines.push(`派发失败原因：${input.dispatchError}`)

  if (input.message) {
    lines.push(`Mailbox: ${input.message.type} (${input.message.id})`)
    if (input.message.task_id) lines.push(`Task: ${input.message.task_id}`)
    lines.push(`Content: ${input.message.content}`)
  }

  if (input.task) {
    lines.push(`Task: ${input.task.title} (${input.task.id})`)
    lines.push(`Status: ${input.task.status}`)
    if (input.task.stage) lines.push(`Stage: ${input.task.stage}`)
  }

  lines.push(
    '',
    '请先使用 team.get 查看最新 Team 状态，然后总结结果或继续派发下一步。',
    '不要使用 sleep、等待命令或轮询；如果还需要其他成员结果，请结束本轮，系统会在新进展到达时再次唤醒你。',
  )

  return buildTeamLeaderWakePrompt(lines.join('\n'))
}

export function buildTeamLeaderWakePrompt(content: string): string {
  return [
    content,
    '',
    '本轮是系统唤醒后的跟进轮；可用 team.status 查看成员的运行态与汇报态，用 team.get 查看成员、任务和 mailbox 汇总。',
  ].join('\n')
}

export interface SilentTurnWakeInput {
  team: TeamRow
  member: TeamMemberRow
  conversation: { id: string; title: string }
  /** 回合结束原因（SessionDoneData.stopReason）；缺省按正常结束处理。 */
  trigger: string
  /** stopReason='error' 时的错误原文。 */
  error?: string | null
  /** 成员最后一条 agent 消息文本；纯工具回合为空。 */
  replyText: string | null
  /** replyText 为空时的回退：本回合最后一个 process item 标题。 */
  fallbackActionTitle?: string | null
  /** 回合开始时刻（human 消息时间戳），用于算"距派发多久"。 */
  dispatchedAtIso: string
  /** 名下未终态任务（展示第一条，帮助 leader 判断卡在哪）。 */
  pendingTasks: Array<{ title: string; id: string; status: string }>
}

/**
 * 静默回合兜底唤醒（P0b）四档模板：正常结束 / 出错 / 被中断。
 * 崩溃（无 committed_done）不在此档，交 P2 周期扫描兜底——见方案文档 §2.2 档④。
 * 三档都必须把成员最后回复的原文带给 leader（用户硬要求）。
 */
export function buildSilentTurnWakePrompt(input: SilentTurnWakeInput): string {
  const header = input.trigger === 'error'
    ? '系统通知：Team 成员回合以错误终止（error），且本回合没有给你发过汇报。'
    : input.trigger === 'cancelled'
      ? '系统通知：Team 成员的回合被中断（cancelled），且中断前没有给你发过汇报。'
      : '系统通知：Team 成员回合结束，但本回合没有给你发过汇报。'
  const lines = [
    header,
    `Team: ${input.team.name} (${input.team.id})`,
    `Member: ${input.member.name} (${input.member.id})`,
    `Conversation: ${input.conversation.title} (${input.conversation.id})`,
  ]
  const task = input.pendingTasks[0]
  if (task) lines.push(`Task: ${task.title} (${task.id}, ${task.status})`)
  lines.push(`距派发: ${formatWakeDuration(Date.now() - Date.parse(input.dispatchedAtIso))}`)
  if (input.trigger === 'error') lines.push(`错误信息：${input.error ?? '（未提供错误详情）'}`)
  if (input.trigger === 'cancelled') lines.push('中断事实：回合被取消（用户手动停止或系统取消），成员当前空闲。')

  lines.push(
    input.trigger === 'cancelled' ? '成员停止时说到哪（截断至 600 字）：' : '成员最后回复（截断至 600 字）：',
    '---',
    input.replyText ?? `（本回合无文本输出${input.fallbackActionTitle ? `；最后动作：${input.fallbackActionTitle}` : ''}）`,
    '---',
  )

  lines.push(...(input.trigger === 'error'
    ? ['建议：先在 team.status 核实该成员是否已恢复空闲，再决定重新派发还是人工处理。']
    : input.trigger === 'cancelled'
      ? ['请先确认中断是否符合预期（例如用户切换了方向）；如任务仍需推进，请重新派发并带上本节上下文。']
      : ['请判断这是"已完成"还是"仍在进行"：可先用 team.status 核实其运行态；若成员其实已完成，让他自己补一条 team.mailbox.send 汇报（不要代写）。']))

  return buildTeamLeaderWakePrompt(lines.join('\n'))
}

const WAKE_REPLY_MAX_CHARS = 600

/** 唤醒 prompt 里的回复正文：折叠连续空行 → 截断到上限（默认 600 字，env 可调）+ 省略号。 */
export function truncateForWake(content: string | null | undefined, maxChars = Number(process.env.TEAM_SILENT_TURN_REPLY_MAX) || WAKE_REPLY_MAX_CHARS): string | null {
  const normalized = content?.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!normalized) return null
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars)}…` : normalized
}

/** "距派发"可读时长：<1 分 → "N 秒"；<1 小时 → "M 分 S 秒"；否则 "H 小时 M 分"。 */
export function formatWakeDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  if (totalSeconds < 60) return `${totalSeconds} 秒`
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes} 分 ${totalSeconds % 60} 秒`
  return `${Math.floor(totalMinutes / 60)} 小时 ${totalMinutes % 60} 分`
}
