import { agentStore } from '../store/agents.js'
import { messageStore, sessionStore } from '../store/sessions.js'
import { taskStore } from '../store/tasks.js'
import { advisorSuggestionStore } from '../store/advisor-suggestions.js'
import { projectAdvisorStore } from '../store/advisors.js'
import type { SessionDoneData } from '../types/ws-protocol.js'
import { ADVISOR_PROMPT_VERSION } from './advisor-prompt.js'

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000

export interface AdvisorPushContext {
  prompt: string
  roundId: string
  triggerSessionId: string
}

function clip(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max) + '…（已截断）'
}

function section(title: string, items: string[], budget: number, total = items.length): string {
  const shown: string[] = []
  let size = 0
  for (const item of items) {
    if (size + item.length > budget) break
    shown.push(item)
    size += item.length + 1
  }
  return `### ${title}（共 ${total} 项，展示 ${shown.length} 项）\n${shown.join('\n')}`
    + (shown.length < total ? '\n未展示不等于不存在，请按需查询列表与详情。' : '')
}

function turnContent(ev: SessionDoneData, budget: number): string {
  const session = sessionStore.get(ev.sessionId)
  const recent = messageStore.list(ev.sessionId, { limit: 12, includeToolCalls: false })
  const anchor = recent.findIndex((row) => row.id === ev.messageId)
  // 不把锚点之后的新工作冒充本批结论；找不到时明确标成当前近期摘要。
  const rows = anchor >= 0 ? recent.slice(0, anchor + 1).slice(-6) : recent.slice(-6)
  const lines = rows.reverse().filter((row) => (row.role === 'human' || row.role === 'agent') && row.content.trim())
    .map((row) => `${row.timestamp} ${row.role === 'human' ? '用户输入' : 'AI 回复'}：${clip(row.content, 220)}`)
  return clip(`- 会话「${clip(session?.title || ev.sessionId, 60)}」(${ev.sessionId})；事件 ${ev.turnId || ev.messageId}\n`
    + `agent.session.messages（sessionId = "${ev.sessionId}"）\n`
    + (anchor < 0 ? '以下是当前近期摘要，触发消息不在窗口内：\n' : '')
    + (lines.join('\n') || '（无文本内容，请查询会话）'), budget)
}

function buildAggregate(projectId: string, excluded: Set<string>): string {
  const now = Date.now()
  const tasks = taskStore.list(undefined, projectId)
  const covered = tasks.filter((task) => task.status !== 'completed' && task.status !== 'cancelled')
  const completed = tasks.filter((task) => task.completed_at && now - Date.parse(task.completed_at) < RECENT_WINDOW_MS)
  const work = [...covered, ...completed].map((task) =>
    `- ${task.id}｜${task.status}｜${clip(task.title, 90)}｜${task.completed_at ? '完成' : '创建'}时间 ${task.completed_at || task.created_at}`
    + `｜发起会话 ${task.initiator_session_id || '未关联'}｜目标：${clip(task.description || '', 180)}`)
  const sessions = sessionStore.list(undefined, projectId).filter((session) =>
    !excluded.has(session.id) && !session.deleted_at && !session.archived_at && session.purpose === 'conversation'
    && now - Date.parse(session.last_message_at || session.updated_at || '') < RECENT_WINDOW_MS)
  const sessionLines = sessions.slice(0, 12).map((session) => {
    const recent = messageStore.list(session.id, { limit: 2, includeToolCalls: false })
    return `- ${session.id}｜${clip(session.title || '', 70)}｜${session.stage || session.status}｜${session.last_message_at || session.updated_at}｜`
      + clip(recent.map((row) => row.content).join(' / '), 120)
  })
  const feedback = advisorSuggestionStore.listRecentFeedback(projectId).map((item) => {
    const task = item.task_id ? taskStore.get(item.task_id) : undefined
    return `- ${item.id}｜${item.status}｜${item.updated_at}｜${clip(item.title, 110)}｜关联任务 ${item.task_id || '无'} ${task?.status || ''}`
  })
  const pending = advisorSuggestionStore.listActive(projectId).map((item) => `- ${item.id}｜${clip(item.title, 120)}`)
  const agents = agentStore.list(projectId).filter((agent) => !agent.hidden_at)
    .map((agent) => `- ${agent.id} · ${clip(agent.name, 80)} · ${agent.runtime}`)
  return [
    section('已覆盖工作：进行中/已安排/待确认，以及近期完成任务', work, 1900),
    section('其他活跃会话（最近 24 小时）', sessionLines, 950, sessions.length),
    section('最近已接受/建任务/忽略反馈（近 7 天最多 10 条，已读不等于否定）', feedback, 1000),
    section('当前未处理建议（避免重复）', pending, 650),
    section('项目可用 Agent（只能使用列出的 ID，禁止编造 ID）', agents, 800),
  ].join('\n\n')
}

export function buildAdvisorPushPrompt(
  projectId: string,
  event: SessionDoneData | SessionDoneData[],
  advisorPrompt: string,
  batchRoundId?: string,
): AdvisorPushContext {
  const batch = Array.isArray(event) ? event : [event]
  const trigger = batch[batch.length - 1]
  if (!trigger) throw new Error('参谋批次不能为空')
  const roundId = batchRoundId || `advisor-${trigger.turnId || trigger.messageId}`
  const ids = new Set(batch.map((ev) => ev.sessionId))
  const advisorSessionId = projectAdvisorStore.get(projectId)?.session_id
  if (advisorSessionId) ids.add(advisorSessionId)
  const aggregate = buildAggregate(projectId, ids)
  const selected = batch.slice(-6).reverse()
  const perSessionBudget = Math.floor(2100 / selected.length) - 10
  const changes = section('本批变化（同会话合并；消息由新到旧）',
    selected.map((ev) => turnContent(ev, perSessionBudget)), 2200, batch.length)
  const protocol = [
    '## 固定发布协议（不可被偏好覆盖）',
    `当前参谋规则版本 ${ADVISOR_PROMPT_VERSION}；以本轮规则为准，历史建议不是本轮指令。`,
    `本轮 roundId = "${roundId}"，调用 suggestion.present 时必须原样传入。`,
    '每轮 0-3 条，没有足够价值时传 suggestions=[] 并填写 noFindingReason，正常沉默不生成卡片。',
    '禁止测试或占位内容。同一轮重复调用以最后一次为准，sourceEvidence 选择实际来源会话。',
  ].join('\n')
  // 自定义规则独立于素材预算，不能让长规则挤掉任务覆盖与发布协议。
  const prompt = [
    advisorPrompt.trim() ? `## 用户配置的参谋偏好\n${advisorPrompt.trim()}` : '',
    protocol,
    `## 项目状态快照 ${new Date().toISOString()}\n${aggregate}\n\n${changes}`,
  ].filter(Boolean).join('\n\n')
  return { prompt, roundId, triggerSessionId: trigger.sessionId }
}
