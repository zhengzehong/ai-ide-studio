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
  newTurns: { turn: number; time: string; user_input: string; agent_output: string }[],
): string {
  const existingJson = JSON.stringify(existingSummaries, null, 2)
  const turnsJson = JSON.stringify(newTurns, null, 2)

  return `你是对话时间线整理助手。根据已有摘要和新增对话，输出更新后的完整摘要列表。

规则：
1. 每条摘要 15-40 字中文，说清做了什么
2. 如果新增轮次和已有摘要在做同一件事，合并为一条，turns 写范围如 "3-5"
3. 如果已有摘要描述需要更准确，直接更新文本
4. 如果已有摘要不需要改动，原样保留在输出中
5. 闲聊写"简单问候"
6. 不要加序号和时间前缀

重要：输出必须包含所有条目（已有的+新增的），我会用输出直接覆盖数据库中对应的记录。
如果某条已有摘要不需要改，也必须原样输出，不能省略。

输出严格 JSON，格式为 {"items":[...]}：
{"items":[
  { "id": "tl-xxx", "text": "摘要内容", "turns": "1-2", "time": "10:17" },
  { "text": "新摘要", "turns": "6", "time": "15:30" }
]}

说明：
- 带 id 的是已有条目（保留或更新文本）
- 不带 id 的是新增条目
- 如果两条被合并，保留其中一条的 id，更新 turns 范围
- 被合并掉的条目不要出现在输出中

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

function collectNewTurns(sessionId: string, rawItems: TimelineSummaryRow[]): { turn: number; time: string; user_input: string; agent_output: string }[] {
  const messages = messageStore.list(sessionId, { limit: 500 })
  const result: { turn: number; time: string; user_input: string; agent_output: string }[] = []

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
      user_input: (userMsg.content || '').slice(0, 150),
      agent_output: (agentReply || '').slice(0, 200),
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

  const existingSummaries = [...recentRefined, ...allRaw].map((r) => ({
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
