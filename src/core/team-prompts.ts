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
}): string {
  return [
    '你正在作为 AI IDE Studio Team 成员执行一次异步协作任务。',
    `Team: ${input.team.name} (${input.team.id})`,
    `Member: ${input.member.name} (${input.member.id})`,
    input.taskId ? `Task: ${input.taskId}` : undefined,
    '',
    '协作规则：',
    '- 只处理本次派发给你的工作，不要自行扩展团队范围。',
    '- 完成、遇到阻塞或需要提问时，必须使用 team.mailbox.send 汇报。',
    '- 如果本次包含 Task ID，只能使用 team.task.update 更新分配给自己的任务状态或阶段。',
    '- 不要填写或伪造 fromMemberId，系统会使用当前成员身份。',
    '- 禁止等待 Leader、禁止 sleep、禁止轮询；提交汇报后结束本轮。',
    '',
    'Leader 派发内容：',
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
}): string {
  const lines = [
    '系统通知：Team 成员有新的异步进展。',
    `Team: ${input.team.name} (${input.team.id})`,
    `Member: ${input.member.name} (${input.member.id})`,
  ]

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
    '本轮是系统唤醒后的跟进轮；现在可以使用 team.get 查看当前 Team 的成员、任务和 mailbox 汇总。',
  ].join('\n')
}
