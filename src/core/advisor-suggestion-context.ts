import { messageStore, sessionStore } from '../store/sessions.js'
import type { AdvisorSourceEvidence, AdvisorSuggestionRow } from '../store/advisor-suggestions.js'

const SOURCE_CONTEXT_MAX_SESSIONS = 4
const SOURCE_CONTEXT_MESSAGES_PER_SESSION = 4
const SOURCE_CONTEXT_PER_MESSAGE_MAX = 400
const SOURCE_CONTEXT_BUDGET = 4_000

/**
 * 建任务时把来源会话近期对话注入任务描述。四段式执行包只说「做什么」，
 * 执行 Agent 还需要参谋当时依据的具体事实（报错/结论/对话），否则拿到任务无从下手。
 */
export function buildSourceContextBlock(suggestion: AdvisorSuggestionRow): string {
  const sessionIds: string[] = []
  if (suggestion.trigger_session_id) sessionIds.push(suggestion.trigger_session_id)
  try {
    const evidence = JSON.parse(suggestion.source_evidence_json) as AdvisorSourceEvidence[]
    if (Array.isArray(evidence)) {
      for (const item of evidence) {
        if (item?.sessionId && !sessionIds.includes(item.sessionId)) sessionIds.push(item.sessionId)
      }
    }
  } catch {
    // 佐证 JSON 损坏不阻断建任务，只用触发会话
  }
  const sections: string[] = []
  let budget = SOURCE_CONTEXT_BUDGET
  for (const sessionId of sessionIds.slice(0, SOURCE_CONTEXT_MAX_SESSIONS)) {
    if (budget <= 0) break
    const session = sessionStore.get(sessionId)
    if (!session || session.deleted_at) continue
    const messages = messageStore.list(sessionId, { limit: SOURCE_CONTEXT_MESSAGES_PER_SESSION, includeToolCalls: false })
      .filter((row) => (row.role === 'human' || row.role === 'agent') && row.content.trim().length > 0)
    if (messages.length === 0) continue
    const lines: string[] = []
    for (const row of messages) {
      if (budget <= 0) break
      const clipped = row.content.trim().length > SOURCE_CONTEXT_PER_MESSAGE_MAX
        ? row.content.trim().slice(0, SOURCE_CONTEXT_PER_MESSAGE_MAX) + '…'
        : row.content.trim()
      budget -= clipped.length
      lines.push(`${row.role === 'human' ? '【用户】' : '【AI】'}${clipped}`)
    }
    if (lines.length > 0) {
      sections.push(`会话「${session.title || sessionId}」（${sessionId}）：\n${lines.join('\n')}`)
    }
  }
  if (sections.length === 0) return ''
  const referenced = sessionIds.slice(0, SOURCE_CONTEXT_MAX_SESSIONS).join('、')
  return `\n\n## 参谋分析依据（来源会话近期对话）\n${sections.join('\n\n')}\n\n需要更早历史时，可调用 agent.session.messages 查看（sessionId：${referenced}）。`
}
