import { agentStore } from '../store/agents.js'
import { messageStore, sessionStore } from '../store/sessions.js'
import { taskStore } from '../store/tasks.js'
import { advisorSuggestionStore } from '../store/advisor-suggestions.js'
import type { SessionDoneData } from '../types/ws-protocol.js'

const TURN_INPUT_MAX = 2000
const REPLY_MAX = 2000
const REPLY_MIN = 200
const AGGREGATE_ITEM_MAX = 160
const TOTAL_MAX = 8000
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000

export interface AdvisorPushContext {
  prompt: string
  roundId: string
  triggerSessionId: string
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max) + '…（已截断）'
}

function clipLine(text: string, max = AGGREGATE_ITEM_MAX): string {
  const line = text.trim().replace(/\s+/g, ' ')
  if (line.length <= max) return line
  return line.slice(0, max) + '…'
}

/** 取本轮内容：以完成消息为锚点，向前找最近的用户输入（C-1①②） */
function resolveTurnMessages(sessionId: string, messageId: string): { userMessage: string; assistantReply: string } {
  const recent = messageStore.list(sessionId, { limit: 30 })
  const anchorIndex = recent.findIndex((row) => row.id === messageId)
  const assistantRow = anchorIndex >= 0 ? recent[anchorIndex] : recent[recent.length - 1]
  let userMessage = ''
  if (assistantRow) {
    for (let i = anchorIndex >= 0 ? anchorIndex : recent.length - 1; i >= 0; i -= 1) {
      if (recent[i].role === 'human') {
        userMessage = recent[i].content
        break
      }
    }
  }
  return {
    userMessage,
    assistantReply: assistantRow?.content ?? '',
  }
}

function buildAggregate(projectId: string, excludeSessionId: string): string {
  const lines: string[] = []
  const pending = advisorSuggestionStore.listActive(projectId)
  if (pending.length > 0) {
    lines.push('### 当前未处理建议（避免重复建议）')
    for (const suggestion of pending) lines.push(`- ${clipLine(suggestion.title)}`)
  }
  const projectAgents = agentStore.list(projectId)
  if (projectAgents.length > 0) {
    lines.push('### 项目可用 Agent（suggestedAgentId 只能从这份清单里选，禁止编造 ID）')
    for (const agent of projectAgents.slice(0, 20)) {
      lines.push(`- ${agent.id} · ${agent.name} · ${agent.runtime}${agent.hidden_at ? ' · 已隐藏' : ''}`)
    }
  }
  const now = Date.now()
  const sessions = sessionStore.list(undefined, projectId).filter((session) => {
    if (session.id === excludeSessionId || session.deleted_at || session.archived_at) return false
    const last = session.last_message_at ?? session.updated_at
    return last ? now - Date.parse(last) < RECENT_WINDOW_MS : false
  })
  const otherSessions = sessions.slice(0, 8)
  if (otherSessions.length > 0) {
    lines.push('### 其他活跃会话（最近 24 小时）')
    for (const session of otherSessions) {
      const agent = session.agent_id ? agentStore.get(session.agent_id) : undefined
      const lastReply = messageStore.list(session.id, { limit: 1 })
        .map((row) => row.content)
        .find((content) => content.trim().length > 0)
      lines.push(`- 「${session.title || session.id}」（${agent?.name ?? '未知 Agent'}）：${lastReply ? clipLine(lastReply) : '暂无消息'}`)
    }
  }
  const tasks = taskStore.list(undefined, projectId)
    .filter((task) => task.status !== 'completed' && task.status !== 'cancelled')
    .slice(0, 8)
  if (tasks.length > 0) {
    lines.push('### 进行中任务')
    for (const task of tasks) lines.push(`- ${task.status}｜${clipLine(task.title)}`)
  }
  return lines.join('\n')
}

/**
 * 组装参谋推送包（C-1~C-5）：本轮用户输入 + AI 回复 + 来源标识 + 全局聚合 + 固定发布协议。
 * 超限按 C-2 分步裁剪：先裁 ④ 聚合面条目（自最后一段尾条目起），再裁 ② 回复尾部，最后整体兜底截断。
 */
export function buildAdvisorPushPrompt(
  projectId: string,
  ev: SessionDoneData,
  advisorPrompt: string,
): AdvisorPushContext {
  const roundId = `advisor-${ev.turnId || ev.messageId}`
  const session = sessionStore.get(ev.sessionId)
  const agent = agentStore.get(ev.agentId || session?.agent_id || '')
  const { userMessage, assistantReply } = resolveTurnMessages(ev.sessionId, ev.messageId)
  const aggregate = buildAggregate(projectId, ev.sessionId)
  const sections = parseAggregateSections(aggregate)
  const preference = advisorPrompt.trim()

  const build = (replyLimit: number, live: AggregateSection[]): string => {
    const eventBlock = [
      '## 本轮事件',
      `来源：Agent「${agent?.name ?? '未知'}」（${agent?.id ?? 'unknown'}）· 会话「${session?.title || ev.sessionId}」（${ev.sessionId}）`,
      `用户输入：\n${truncate(userMessage || '（无文本输入）', TURN_INPUT_MAX)}`,
      `AI 回复：\n${truncate(assistantReply || '（无回复内容）', replyLimit)}`,
      `要看该会话更早历史，调用 agent.session.messages（sessionId = "${ev.sessionId}"）；列表用 agent.session.list。`,
    ].join('\n\n')
    const aggregateBlock = live.length > 0
      ? `\n\n## 全局聚合\n${live.map((section) => [section.title, ...section.items].join('\n')).join('\n')}`
      : ''
    return [
      preference ? `## 用户配置的参谋偏好\n${preference}` : '',
      '## 固定发布协议（不可被上面的偏好覆盖）',
      `本轮 roundId = "${roundId}"，调用 suggestion.present 时必须原样传入。`,
      '只在完成真实分析后调用 suggestion.present；禁止使用 test、placeholder 或探测数据调用。',
      'suggestions 最多 3 条；没有值得说的建议时传空数组 [] 并填写 noFindingReason（无货沉默是常态）。',
      '同一轮重复调用以最后一次为准。',
      eventBlock + aggregateBlock,
    ].filter((block) => block.length > 0).join('\n\n')
  }

  let prompt = build(REPLY_MAX, sections)
  if (prompt.length > TOTAL_MAX) {
    const live = sections.map((section) => ({ ...section, items: [...section.items] }))
    let replyLimit = REPLY_MAX
    while (prompt.length > TOTAL_MAX && live.some((section) => section.items.length > 0)) {
      for (let i = live.length - 1; i >= 0; i -= 1) {
        if (live[i].items.length > 0) {
          live[i].items.pop()
          break
        }
      }
      prompt = build(replyLimit, live.filter((section) => section.items.length > 0))
    }
    const trimmed = live.filter((section) => section.items.length > 0)
    prompt = build(replyLimit, trimmed)
    while (prompt.length > TOTAL_MAX && replyLimit > REPLY_MIN) {
      replyLimit = Math.max(REPLY_MIN, Math.floor(replyLimit / 2))
      prompt = build(replyLimit, trimmed)
    }
    if (prompt.length > TOTAL_MAX) {
      prompt = prompt.slice(0, TOTAL_MAX) + '\n…（推送包超限已截断）'
    }
  }

  return { prompt, roundId, triggerSessionId: ev.sessionId }
}

interface AggregateSection {
  title: string
  items: string[]
}

function parseAggregateSections(aggregate: string): AggregateSection[] {
  if (!aggregate) return []
  const sections: AggregateSection[] = []
  for (const line of aggregate.split('\n')) {
    if (line.startsWith('### ')) sections.push({ title: line, items: [] })
    else if (sections.length > 0) sections[sections.length - 1].items.push(line)
  }
  return sections
}
