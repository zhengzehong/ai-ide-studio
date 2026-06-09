import { createChildLogger } from './logger.js'
import { events } from './events.js'
import { timelineStore, timelineConfigStore } from '../store/timeline.js'
import { sessionStore, messageStore } from '../store/sessions.js'
import { modelProviderStore } from '../store/model-providers.js'
import { getDb } from '../store/db.js'
import type { TimelineSummaryRow, TimelineConfigRow } from '../store/timeline.js'

const log = createChildLogger('timeline')

const refiningLock = new Set<string>()

interface TimelineOutputItem {
  id?: string
  text: string
  turns: string
  time: string
}

type TimelineTextPart = { part: 'beginning' | 'middle' | 'ending'; text: string }

interface TimelineTurnInput {
  turn: number
  time: string
  user_input: string
  agent_output?: string
  agent_output_note?: string
  agent_output_parts?: TimelineTextPart[]
}

const TIMELINE_FULL_TEXT_UNIT_LIMIT = 3000
const TIMELINE_LONG_SECTION_CHARS = 2000

function generateRawPlaceholder(userMessage: string): string {
  const text = (userMessage || '').trim().slice(0, 30)
  return text ? `🔧 ${text}...` : '对话进行中'
}

function getConfigForSession(sessionId: string): TimelineConfigRow | undefined {
  const session = sessionStore.get(sessionId)
  if (!session?.project_id) return undefined
  return timelineConfigStore.get(session.project_id)
}

function isUserMessageRole(role: string): boolean {
  return role === 'human' || role === 'user'
}

function normalizeTimelineText(value: string): string {
  return value
    .replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=]+/g, '[omitted base64 data]')
    .replace(/[A-Za-z0-9+/]{800,}={0,2}/g, '[omitted encoded data]')
    .split('')
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code === 9 || code === 10 || code === 13 || code >= 32
    })
    .join('')
    .replace(/\r\n/g, '\n')
    .trim()
}

function countTimelineTextUnits(text: string): number {
  const cjkChars = text.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g)?.length ?? 0
  const englishWords = text.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g)?.length ?? 0
  return cjkChars + englishWords
}

function prepareAgentOutputForTimeline(content: string): Pick<TimelineTurnInput, 'agent_output' | 'agent_output_note' | 'agent_output_parts'> {
  const text = normalizeTimelineText(content)
  if (!text) return {}
  if (countTimelineTextUnits(text) <= TIMELINE_FULL_TEXT_UNIT_LIMIT) return { agent_output: text }

  const sectionLength = Math.min(TIMELINE_LONG_SECTION_CHARS, Math.ceil(text.length / 3))
  const middleStart = Math.max(0, Math.floor((text.length - sectionLength) / 2))
  return {
    agent_output_note: `Agent output was long and is provided as beginning/middle/ending excerpts. Prefer the ending excerpt for final result.`,
    agent_output_parts: [
      { part: 'beginning', text: text.slice(0, sectionLength) },
      { part: 'middle', text: text.slice(middleStart, middleStart + sectionLength) },
      { part: 'ending', text: text.slice(-sectionLength) },
    ],
  }
}

function resolveApiCredentials(config: TimelineConfigRow): { apiKey: string; baseUrl: string; model: string } | undefined {
  let apiKey = config.api_key || ''
  let baseUrl = config.base_url || ''

  if (config.provider_id) {
    const provider = modelProviderStore.get(config.provider_id)
    if (provider) {
      if (!apiKey) apiKey = provider.api_key
      if (!baseUrl) baseUrl = provider.base_url
    }
  }

  if (!apiKey || !baseUrl || !config.model) return undefined
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, ''), model: config.model }
}

function buildPrompt(
  existingSummaries: { id: string; text: string; turns: string; time: string }[],
  newTurns: TimelineTurnInput[],
): string {
  const existingJson = JSON.stringify(existingSummaries, null, 2)
  const turnsJson = JSON.stringify(newTurns, null, 2)

  return `你是会话工作时间线整理助手。你的任务是生成工作记录，不是复述用户指令。
每条摘要必须说明：
1. 处理对象：具体功能、模块、问题、文件范围或任务主题。
2. 实际动作：分析、修复、实现、审查、验证、提交、同步等。
3. 最终结果：发现了什么、改了什么、是否通过验证、是否已提交/同步、是否中断。
规则：
1. 优先从 agent_output 或 agent_output_parts 里提取最终结果；user_input 只用于理解任务背景。
2. 如果 agent_output 为空或会话中断，再说明“未形成最终结论/会话中断”。
3. 每条 1-2 句话，最多 3 句话；不要超过 120 个中文字符。
4. 不要输出泛泛摘要，如“审查代码”“查询当前状态”“请求分析”“按方案改造”。
5. 如果新增轮次和已有摘要在做同一件事，合并为一条，turns 写范围如 "3-5"。
6. 如果已有摘要描述需要更准确，直接更新文本；如果无需改动，原样保留在输出中。
7. 不要加序号和时间前缀。
Good example 1:
user_input: 审查一下，没问题提交commit，并且更新到prd分支
agent_output: 审查后没发现阻塞问题，已提交并更新到 prd。master: bb11d98 feat: show ACP diff file changes；prd: a2a3427。npm test/build/lint 通过。
summary: 审查 ACP diff 文件变更展示逻辑，确认 test、build、lint 通过。已提交 master 并同步到 prd。
Good example 2:
user_input: ok，按这个方案改一下，改完做好审查，如果没问题同步到prd分支
agent_output: 已按“会话优先”把桌面悬浮部件改完，改为显示运行中/未读 Session 并支持定位主窗口。审查通过，已同步 prd。
summary: 实现桌面悬浮部件的会话优先活动流，改为展示运行中/未读 Session 并支持定位主窗口。审查通过后已同步到 prd。
Bad example:
- 审查代码并提交commit，同步到prd分支
- 按方案改造并审查，同步到prd分支
- 查询当前状态
这些只是在复述请求，没有说明处理对象、实际动作和最终结果。
重要：输出必须包含所有条目（已有的+新增的），我会用输出直接覆盖数据库中对应的记录。
如果某条已有摘要不需要改，也必须原样输出，不能省略。
输出严格 JSON，格式为 {"items":[...]}：
{"items":[
  { "id": "tl-xxx", "text": "摘要内容", "turns": "1-2", "time": "10:17" },
  { "text": "新摘要", "turns": "6", "time": "15:30" }
]}
说明：
- 带 id 的是已有条目（保留或更新文本）。
- 不带 id 的是新增条目。
- 如果两条被合并，保留其中一条的 id，更新 turns 范围。
- 被合并掉的条目不要出现在输出中。

已有摘要：
${existingJson}

新增轮次：
${turnsJson}

输出 JSON：`
}

async function callOpenAIModel(
  creds: { apiKey: string; baseUrl: string; model: string },
  prompt: string,
): Promise<string> {
  const url = `${creds.baseUrl}/v1/chat/completions`
  const body = {
    model: creds.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 800,
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Timeline model API error ${resp.status}: ${text.slice(0, 200)}`)
  }

  const data = (await resp.json()) as { choices: { message: { content: string } }[] }
  return data.choices?.[0]?.message?.content ?? ''
}

function parseModelOutput(raw: string): TimelineOutputItem[] {
  let text = raw.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) throw new Error(`Cannot parse timeline model output: ${text.slice(0, 200)}`)
    parsed = JSON.parse(match[0])
  }

  if (Array.isArray(parsed)) return parsed as TimelineOutputItem[]
  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>
    if (Array.isArray(obj.items)) return obj.items as TimelineOutputItem[]
    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) return value as TimelineOutputItem[]
    }
  }
  throw new Error(`Unexpected timeline model output shape: ${text.slice(0, 200)}`)
}

function resolveRealTimestamp(sessionId: string, rawItems: TimelineSummaryRow[], item: TimelineOutputItem): string {
  const turnMatch = item.turns.match(/^(\d+)/)
  if (!turnMatch) return new Date().toISOString()
  const turnNum = parseInt(turnMatch[1], 10)

  for (const raw of rawItems) {
    const rawTurn = parseInt(raw.turns, 10)
    if (rawTurn === turnNum) return raw.turn_start_at
  }
  return new Date().toISOString()
}

function applyModelOutput(
  sessionId: string,
  inputIds: string[],
  rawItems: TimelineSummaryRow[],
  output: TimelineOutputItem[],
  modelUsed: string,
): void {
  const db = getDb()
  const inputIdSet = new Set(inputIds)

  const keepOrUpdate = output.filter((o) => o.id)
  const keepIds = new Set(keepOrUpdate.map((o) => o.id!))
  const deleteIds = inputIds.filter((id) => !keepIds.has(id))
  const newItems = output.filter((o) => !o.id)
  const rawTurns = rawItems.map((r) => r.turns)

  db.transaction(() => {
    for (const id of deleteIds) {
      timelineStore.delete(id)
    }
    for (const item of keepOrUpdate) {
      if (inputIdSet.has(item.id!)) {
        timelineStore.updateRefined(item.id!, item.text, item.turns, modelUsed)
      }
    }
    for (const item of newItems) {
      const realTime = resolveRealTimestamp(sessionId, rawItems, item)
      timelineStore.insertRefined(sessionId, item.text, item.turns, realTime, modelUsed)
    }
    timelineStore.deleteRawByTurns(sessionId, rawTurns)
  })()
}

function collectNewTurns(sessionId: string, rawItems: TimelineSummaryRow[]): TimelineTurnInput[] {
  const messages = messageStore.list(sessionId, { limit: 500 })
  const result: TimelineTurnInput[] = []

  for (const raw of rawItems) {
    const turnNum = parseInt(raw.turns, 10)
    if (isNaN(turnNum)) continue

    const userMsgs = messages.filter((m) => isUserMessageRole(m.role))
    const userMsg = userMsgs[turnNum - 1]
    if (!userMsg) continue

    const userIdx = messages.indexOf(userMsg)
    let agentReply = ''
    for (let i = userIdx + 1; i < messages.length; i++) {
      if (isUserMessageRole(messages[i].role)) break
      if (messages[i].role === 'agent' || messages[i].role === 'assistant') {
        agentReply = messages[i].content
      }
    }

    const timeStr = new Date(userMsg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    result.push({
      turn: turnNum,
      time: timeStr,
      user_input: normalizeTimelineText(userMsg.content || ''),
      ...prepareAgentOutputForTimeline(agentReply || ''),
    })
  }
  return result
}

async function runModelRefine(sessionId: string, config: TimelineConfigRow): Promise<void> {
  const creds = resolveApiCredentials(config)
  if (!creds) {
    log.warn({ sessionId }, 'Timeline: 无法解析 API 凭证，跳过模型整理')
    return
  }

  const allRaw = timelineStore.listRaw(sessionId)
  if (allRaw.length === 0) return

  const recentRefined = timelineStore.getRecentRefined(sessionId, 5)

  const existingSummaries = recentRefined.map((r) => ({
    id: r.id,
    text: r.summary,
    turns: r.turns,
    time: new Date(r.turn_start_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
  }))

  const newTurns = collectNewTurns(sessionId, allRaw)
  if (newTurns.length === 0) return

  const inputIds = [...recentRefined, ...allRaw].map((r) => r.id)
  const prompt = buildPrompt(existingSummaries, newTurns)

  log.info({ sessionId, refinedCount: recentRefined.length, rawCount: allRaw.length, model: creds.model }, 'Timeline: 开始模型整理')

  const raw = await callOpenAIModel(creds, prompt)
  const output = parseModelOutput(raw)
  applyModelOutput(sessionId, inputIds, allRaw, output, creds.model)
  events.emit('timeline:updated', { sessionId })
  log.info({ sessionId, outputCount: output.length }, 'Timeline: 模型整理完成')
}

function onTurnDone(sessionId: string): void {
  const config = getConfigForSession(sessionId)
  if (!config || !config.enabled) return

  const messages = messageStore.list(sessionId, { limit: 500 })
  const userMessages = messages.filter((m) => isUserMessageRole(m.role))
  const turnIndex = userMessages.length
  if (turnIndex <= 0) return

  const latestUserMsg = userMessages[turnIndex - 1]
  const rawSummary = generateRawPlaceholder(latestUserMsg.content)
  const turnStartAt = latestUserMsg.timestamp

  timelineStore.insertRaw(sessionId, turnIndex, rawSummary, turnStartAt)

  const rawCount = timelineStore.countByStatus(sessionId, 'raw')
  if (rawCount >= config.trigger_interval) {
    if (refiningLock.has(sessionId)) {
      log.debug({ sessionId }, 'Timeline: 该会话正在整理中，跳过')
      return
    }
    refiningLock.add(sessionId)
    runModelRefine(sessionId, config)
      .catch((err) => {
        log.error({ err, sessionId }, 'Timeline: 异步整理失败')
      })
      .finally(() => {
        refiningLock.delete(sessionId)
      })
  }
}

export function initTimeline(): void {
  events.on('session:done', (ev) => {
    if (ev.stopReason === 'cancelled' || ev.stopReason === 'error') return
    try {
      onTurnDone(ev.sessionId)
    } catch (err) {
      log.error({ err, sessionId: ev.sessionId }, 'Timeline: onTurnDone 异常')
    }
  })
  log.info('Timeline: 已初始化，监听 session:done 事件')
}

export async function refineTimeline(sessionId: string): Promise<void> {
  const config = getConfigForSession(sessionId)
  if (!config || !config.enabled) {
    throw new Error('时间线功能未启用或未配置')
  }
  if (refiningLock.has(sessionId)) {
    throw new Error('该会话正在整理中，请稍后')
  }
  refiningLock.add(sessionId)
  try {
    await runModelRefine(sessionId, config)
  } finally {
    refiningLock.delete(sessionId)
  }
}

export async function generateHistoricalTimeline(sessionId: string): Promise<void> {
  const config = getConfigForSession(sessionId)
  if (!config || !config.enabled) {
    throw new Error('时间线功能未启用或未配置')
  }

  const existing = timelineStore.list(sessionId)
  if (existing.length > 0) return

  const messages = messageStore.list(sessionId, { limit: 500 })
  const userMessages = messages.filter((m) => isUserMessageRole(m.role))
  if (userMessages.length === 0) return

  for (let i = 0; i < userMessages.length; i++) {
    const um = userMessages[i]
    const rawSummary = generateRawPlaceholder(um.content)
    timelineStore.insertRaw(sessionId, i + 1, rawSummary, um.timestamp)
  }

  events.emit('timeline:updated', { sessionId })

  const interval = config.trigger_interval || 3
  const totalBatches = Math.ceil(userMessages.length / interval)
  refiningLock.add(sessionId)
  try {
    for (let batch = 0; batch < totalBatches; batch++) {
      const pendingRaw = timelineStore.listRaw(sessionId)
      if (pendingRaw.length === 0) break
      try {
        await runModelRefine(sessionId, config)
      } catch (err) {
        log.error({ err, sessionId, batch }, 'Timeline: 历史批量整理失败')
        break
      }
    }
  } finally {
    refiningLock.delete(sessionId)
  }
}
