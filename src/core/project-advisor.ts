import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { agentStore } from '../store/agents.js'
import { getDbPath } from '../store/db.js'
import { projectStore } from '../store/projects.js'
import { messageStore, sessionStore } from '../store/sessions.js'
import { previewStore } from '../store/previews.js'
import { projectAdvisorStore, type ProjectAdvisorRow } from '../store/advisors.js'
import {
  advisorSuggestionStore,
  type AdvisorSourceEvidence,
  type AdvisorSuggestionRow,
  type CreateAdvisorSuggestionInput,
  type AdvisorSuggestionType,
} from '../store/advisor-suggestions.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { enqueueProjectInspirationTurn } from './project-inspiration-turn-queue.js'
import { buildAdvisorPushPrompt } from './advisor-push.js'
import { sessionManager } from './sessions.js'
import { resolveTaskSession, taskManager } from './tasks.js'
import { taskStepManager } from './task-steps.js'
import { createSimpleTask } from './task-simple.js'
import type { SessionDoneData } from '../types/ws-protocol.js'

const log = createChildLogger('project-advisor')

export const DEFAULT_ADVISOR_PROMPT = [
  '你是当前项目的 AI 参谋。',
  '',
  '## 核心工作原则',
  '你的核心能力不局限单轮对话，而是聚合用户当日全量行为 + 本轮即时上下文综合分析产出建议。优先贴合用户全天整体意图，其次补全本轮细节。',
  '',
  '## 分析依据（双维度聚合）',
  '1. 本轮即时上下文：抓取最新一轮对话的即时诉求、突发疑问、临时卡点。',
  '2. 用户当日全局聚合倾向：汇总今日所有会话记录，提炼用户全天行为特征——今日主线工作、高频提问领域、反复纠结的问题、遗留未闭环事项、持续迭代的项目进度。',
  '',
  '## 有价值优先：只给增量建议',
  '你的定位是「下一步行动顾问」。建议的价值在于增量：用户已明确要做的事、正在执行中的事，不缺你重复；你要给的是它们之外的衍生问题、后续动作和关联风险。',
  '值得给的建议（正面清单）：',
  '- 衍生问题：本轮工作中暴露出的、还没人管的新问题（修 A 时发现 B 也有同样的坑）',
  '- 下一步闭环：当前事项完成或告一段落后值得马上做的（补回归测试、更新文档、通知相关人员、清理临时方案）',
  '- 关联风险：与当前工作强相关的隐患排查（同类逻辑在其他模块是否有同样问题）',
  '- 遗留闭环：当日聚合里反复出现但一直没人认领的未闭环事项',
  '反例（禁止）：用户让 AI 修列表页白屏、AI 正在修——此时你建议「对列表页做虚拟滚动」「建议先定位 RowItem 重复创建的原因」。这些是正在做的事本身和它的执行细节，说了等于没说。',
  '正例（应该给）：同样的轮次——你建议「RowItem 的问题在 PaymentList、OrderList 还有两处，建议一并修」「修完后建议补一条 200 条数据的回归测试，防复发」。前者是本轮暴露的衍生问题，后者是修复后的下一步闭环。',
  '自检三问（每条建议提交前过一遍）：这件事有人正在做吗？用户已经明确要做了吗？它是「下一步」还是「当前步骤怎么做」？任一命中前者 → 丢弃，不算增量。',
  '没有增量建议时传空数组，noFindingReason 写明依据（如「修复列表页白屏正在处理中，本轮无增量建议」）。',
  '',
  '## 输出规则',
  '- 有有效价值建议：调用 suggestion.present 提交 1~3 条增量建议（衍生问题/下一步闭环/关联风险/遗留闭环），禁止与用户正在做或已明确要做的事重复',
  '- 无价值建议：传空数组并用 noFindingReason 说明（无建议属于正常常态）',
  '',
  '## 单条建议强制结构（缺一不可）',
  '每条建议必须包含：类型（plan=附完整 HTML 方案文档 / action=说明即执行包）、标题、预填执行包（四段式：背景/目标/交付物/验收标准）、推荐 Agent 和理由、来源佐证会话。',
  'plan 类型必须同时提交 artifactName 和完整可独立打开的 artifactHtml。',
  '执行包的「背景」必须写具体事实（报错信息、根因结论、涉及的文件/模块），禁止只写空泛描述——用户接受后任务会附带来源会话对话，但背景本身必须自带关键事实。',
  '',
  '## 可用工具',
  '可调用 agent.session.messages 查看来源会话更早历史；相关上下文用 agent.session.list 浏览活跃会话。',
  '',
  '## 推荐 Agent 硬约束',
  'suggestedAgentId 只能从推送包「项目可用 Agent」清单里选（原样复制清单中的 ID），禁止编造或使用清单之外的 ID。',
  '',
  '## 特殊强制约束',
  '不得直接创建或派发任务，必须调用 suggestion.present 提交，等待用户确认。',
].join('\n')

const MAX_SUGGESTIONS_PER_ROUND = 3
const SAME_SESSION_DEBOUNCE_MS = 5 * 60 * 1000
const PROJECT_MIN_INTERVAL_MS = 3 * 60 * 1000
/** roundId 登记的保活上限：超时未结算的登记在下次写入时惰性回收（防 Map 慢泄漏） */
const ROUND_REGISTRATION_TTL_MS = 10 * 60 * 1000
/** 建任务时注入来源会话上下文的预算：最多 4 个会话、每会话最近 4 条、单条截 400 字符、总预算 4000 字符 */
const SOURCE_CONTEXT_MAX_SESSIONS = 4
const SOURCE_CONTEXT_MESSAGES_PER_SESSION = 4
const SOURCE_CONTEXT_PER_MESSAGE_MAX = 400
const SOURCE_CONTEXT_BUDGET = 4_000

/**
 * 建任务时把来源会话近期对话注入任务描述。四段式执行包只说「做什么」，
 * 执行 Agent 还需要参谋当时依据的具体事实（报错/结论/对话），否则拿到任务无从下手。
 */
function buildSourceContextBlock(suggestion: AdvisorSuggestionRow): string {
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

/** roundId → 轮次登记（发布建议时回写触发会话；S-8 结算后回收） */
interface RoundRegistration {
  triggerSessionId: string
  advisorSessionId: string
  injectedAt: number
}

const roundTriggerSessions = new Map<string, RoundRegistration>()

interface ProjectAdvisorRuntimeState {
  lastInjectAt: number
  lastInjectPerSession: Map<string, number>
  pendingTimer: ReturnType<typeof setTimeout> | null
  pendingEvents: Map<string, SessionDoneData>
}

const runtimeStates = new Map<string, ProjectAdvisorRuntimeState>()

function getRuntimeState(projectId: string): ProjectAdvisorRuntimeState {
  let state = runtimeStates.get(projectId)
  if (!state) {
    state = { lastInjectAt: 0, lastInjectPerSession: new Map(), pendingTimer: null, pendingEvents: new Map() }
    runtimeStates.set(projectId, state)
  }
  return state
}

export interface AdvisorSuggestionView {
  suggestions: AdvisorSuggestionRow[]
  expired: AdvisorSuggestionRow[]
  settled: AdvisorSuggestionRow[]
  pendingCount: number
}

export function getAdvisorWorkspace(projectId: string): { config: ReturnType<typeof projectAdvisorStore.toData>; suggestions: AdvisorSuggestionView } {
  requireProject(projectId)
  const config = ensureProjectAdvisorRow(projectId)
  return {
    config: projectAdvisorStore.toData(config),
    suggestions: listAdvisorSuggestions(projectId),
  }
}

function listAdvisorSuggestions(projectId: string): AdvisorSuggestionView {
  const now = new Date().toISOString()
  return {
    suggestions: advisorSuggestionStore.listActive(projectId, now),
    expired: advisorSuggestionStore.listExpiredPending(projectId, now),
    settled: advisorSuggestionStore.listSettled(projectId, now),
    pendingCount: advisorSuggestionStore.countPending(projectId, now),
  }
}

export function listAdvisorSuggestionsFor(projectId: string): AdvisorSuggestionView {
  return listAdvisorSuggestions(projectId)
}

/** 首次访问自动建默认配置（U-22）；专属会话惰性创建（配置了 Agent 后） */
export function ensureProjectAdvisorRow(projectId: string): ProjectAdvisorRow {
  const config = projectAdvisorStore.ensure(projectId)
  if (!config.advisor_prompt) {
    return projectAdvisorStore.update(projectId, { advisorPrompt: DEFAULT_ADVISOR_PROMPT })
  }
  return config
}

export async function configureAdvisor(
  projectId: string,
  input: {
    advisorAgentId: string
    advisorPrompt?: string
    minSilenceMinutes?: number
    enabled?: boolean
  },
): Promise<ReturnType<typeof projectAdvisorStore.toData>> {
  requireProject(projectId)
  const agent = agentStore.get(input.advisorAgentId)
  if (!agent) throw new Error('参谋 Agent 不存在')
  if (agent.project_id && agent.project_id !== projectId) throw new Error('参谋 Agent 不属于当前项目')
  const current = ensureProjectAdvisorRow(projectId)
  if (current.session_id && current.advisor_agent_id && current.advisor_agent_id !== input.advisorAgentId) {
    throw new Error('更换参谋 Agent 需要先重建参谋会话')
  }
  let sessionId = current.session_id
  const existingSession = sessionId ? sessionStore.get(sessionId) : undefined
  if (!existingSession || existingSession.deleted_at || existingSession.status !== 'active') {
    const session = await sessionManager.createSession(input.advisorAgentId, undefined, projectId, 'conversation')
    sessionStore.updateTitle(session.id, '项目参谋会话')
    sessionId = session.id
  }
  const updated = projectAdvisorStore.update(projectId, {
    advisorAgentId: input.advisorAgentId,
    sessionId,
    advisorPrompt: input.advisorPrompt ?? (current.advisor_prompt || DEFAULT_ADVISOR_PROMPT),
    minSilenceMinutes: input.minSilenceMinutes,
    enabled: input.enabled,
    lastError: null,
  })
  emitUpdate(projectId)
  log.info({ projectId, agentId: input.advisorAgentId, sessionId }, '项目参谋已配置')
  return projectAdvisorStore.toData(updated)
}

export async function rebuildAdvisorSession(projectId: string, advisorAgentId: string): Promise<ReturnType<typeof projectAdvisorStore.toData>> {
  const agent = agentStore.get(advisorAgentId)
  if (!agent) throw new Error('参谋 Agent 不存在')
  if (agent.project_id && agent.project_id !== projectId) throw new Error('参谋 Agent 不属于当前项目')
  const session = await sessionManager.createSession(advisorAgentId, undefined, projectId, 'conversation')
  sessionStore.updateTitle(session.id, '项目参谋会话')
  const updated = projectAdvisorStore.update(projectId, {
    advisorAgentId,
    sessionId: session.id,
    lastError: null,
  })
  const state = runtimeStates.get(projectId)
  if (state) {
    state.lastInjectPerSession.clear()
    state.pendingEvents.clear()
  }
  emitUpdate(projectId)
  log.info({ projectId, advisorAgentId, sessionId: session.id }, '项目参谋会话已重建')
  return projectAdvisorStore.toData(updated)
}

/**
 * session:done 钩子（T-1~T-6）：过滤 → 去抖合并 → 串行队列注入参谋会话。
 * 任何异常只记日志，绝不影响被观察会话。
 */
export function handleSessionTurnDone(ev: SessionDoneData): void {
  try {
    const configs = findEnabledAdvisors()
    if (configs.length === 0) return
    const session = sessionStore.get(ev.sessionId)
    if (!session) return
    const config = configs.find((row) => row.project_id === session.project_id)
    if (!config) return
    // T-2 过滤：参谋会话自身完成一轮 → 结算未产卡的轮次（S-8），不进入推送流程
    if (config.session_id && ev.sessionId === config.session_id) {
      settleAdvisorRounds(config.session_id)
      return
    }
    // T-2c 过滤：只推正常完成的轮次（stopReason === 'end_turn'）。手动停止（cancelled）/报错（error）/
    // 截断（max_tokens 等）的 AI 回复是 abort 碎片，没有分析价值；且用户停止多为纠正 AI，纠正后的下一轮才是有效素材。
    // 必须在 pendingEvents.set 之前：否则停止轮会按 T-3 覆盖语义挤掉同会话未推送的正常轮。
    if (ev.stopReason !== 'end_turn') return
    // T-2 过滤：非普通会话（系统、autonomy 等）
    if (session.purpose !== 'conversation') return
    if (!session.project_id) return

    const now = Date.now()
    const state = getRuntimeState(config.project_id)
    // T-3：去抖窗口内的后续轮次覆盖同会话暂存快照（flush 时只推最新一轮），不逐轮丢弃
    state.pendingEvents.set(ev.sessionId, ev)

    const sinceLastInject = now - state.lastInjectAt
    if (sinceLastInject < PROJECT_MIN_INTERVAL_MS) {
      schedulePendingFlush(config.project_id, PROJECT_MIN_INTERVAL_MS - sinceLastInject)
      return
    }
    void flushPendingAdvisory(config.project_id).catch((err: unknown) => {
      log.error({ err, projectId: config.project_id }, '参谋推送注入失败')
    })
  } catch (err) {
    log.warn({ err, sessionId: ev.sessionId }, '参谋 session:done 钩子处理失败')
  }
}

function schedulePendingFlush(projectId: string, delayMs: number): void {
  const state = getRuntimeState(projectId)
  if (state.pendingTimer) return
  state.pendingTimer = setTimeout(() => {
    state.pendingTimer = null
    void flushPendingAdvisory(projectId).catch((err: unknown) => {
      log.error({ err, projectId }, '参谋积压推送注入失败')
    })
  }, Math.max(delayMs, 1000))
}

/**
 * T-3/T-4：flush 推每个会话的最新一轮（pendingEvents 同会话覆盖）。
 * 同会话 5 分钟去抖窗口未到的会话暂留 pending，窗口到点后补推（调度 follow-up）。
 */
async function flushPendingAdvisory(projectId: string): Promise<void> {
  const state = getRuntimeState(projectId)
  if (state.pendingEvents.size === 0) return
  const now = Date.now()
  let nextEligibleDelay = Number.POSITIVE_INFINITY
  const ready: SessionDoneData[] = []
  for (const [sessionId, ev] of state.pendingEvents) {
    const windowStart = state.lastInjectPerSession.get(sessionId)
    if (windowStart !== undefined && now - windowStart < SAME_SESSION_DEBOUNCE_MS) {
      nextEligibleDelay = Math.min(nextEligibleDelay, SAME_SESSION_DEBOUNCE_MS - (now - windowStart))
      continue
    }
    ready.push(ev)
  }
  for (const ev of ready) state.pendingEvents.delete(ev.sessionId)
  for (const ev of ready) {
    await enqueueProjectInspirationTurn(projectId, () => injectAdvisorTurn(projectId, ev))
  }
  if (state.pendingEvents.size > 0) {
    schedulePendingFlush(projectId, Number.isFinite(nextEligibleDelay) ? nextEligibleDelay : PROJECT_MIN_INTERVAL_MS)
  }
}

async function injectAdvisorTurn(projectId: string, ev: SessionDoneData): Promise<void> {
  const config = projectAdvisorStore.get(projectId)
  if (!config?.enabled || !config.session_id || !config.advisor_agent_id) return
  pruneStaleRoundRegistrations()
  const advisorPrompt = config.advisor_prompt || DEFAULT_ADVISOR_PROMPT
  const { prompt, roundId } = buildAdvisorPushPrompt(projectId, ev, advisorPrompt)
  roundTriggerSessions.set(roundId, {
    triggerSessionId: ev.sessionId,
    advisorSessionId: config.session_id,
    injectedAt: Date.now(),
  })
  await sessionManager.enqueuePrompt(config.session_id, prompt, undefined, {
    contextProjectId: projectId,
    senderRole: 'advisor',
    senderName: 'AI 参谋',
    batchKey: `advisor-round:${roundId}`,
    dedupeKey: `advisor:${roundId}`,
  })
  const state = getRuntimeState(projectId)
  state.lastInjectAt = Date.now()
  state.lastInjectPerSession.set(ev.sessionId, state.lastInjectAt)
  projectAdvisorStore.update(projectId, { lastError: null })
  log.info({ projectId, roundId, sessionId: ev.sessionId }, '参谋轮次已注入')
}

/** 下次写入时惰性回收超时未结算的轮次登记（防 Map 慢泄漏） */
function pruneStaleRoundRegistrations(): void {
  const now = Date.now()
  for (const [roundId, entry] of roundTriggerSessions) {
    if (now - entry.injectedAt > ROUND_REGISTRATION_TTL_MS) roundTriggerSessions.delete(roundId)
  }
}

/**
 * S-8：参谋会话自身完成一轮时结算——仍登记在册的轮次若台账无记录，判定该轮失败：
 * 记日志、不产卡、不重试（下一轮事件自然再来），并回收登记。
 */
function settleAdvisorRounds(advisorSessionId: string): void {
  const now = Date.now()
  for (const [roundId, entry] of roundTriggerSessions) {
    if (entry.advisorSessionId !== advisorSessionId) continue
    if (now - entry.injectedAt > ROUND_REGISTRATION_TTL_MS) {
      roundTriggerSessions.delete(roundId)
      continue
    }
    if (!advisorSuggestionStore.hasRound(roundId)) {
      log.warn({ roundId, advisorSessionId }, 'S-8 参谋完成一轮但未调用 suggestion.present，本轮不产卡不重试')
    }
    roundTriggerSessions.delete(roundId)
  }
}

/** 参谋提交结构化建议（S-1~S-9，由 suggestion.present 工具调用） */
export async function publishSuggestions(
  context: { projectId?: string; sessionId?: string },
  input: {
    roundId: string
    noFindingReason?: string
    suggestions: Array<{
      type: AdvisorSuggestionType
      title: string
      descriptionMarkdown: string
      suggestedAgentId?: string | null
      agentReason?: string
      sourceEvidence: AdvisorSourceEvidence[]
      artifactName?: string
      artifactHtml?: string
    }>
  },
): Promise<{ roundId: string; stored: number; noFinding: boolean }> {
  if (!context.projectId || !context.sessionId) throw new Error('缺少项目或 Session 上下文')
  const config = projectAdvisorStore.findBySession(context.sessionId)
  if (!config || config.project_id !== context.projectId) throw new Error('当前 Session 不是项目参谋会话')
  if (!input.roundId.trim()) throw new Error('roundId 不能为空')
  if (input.suggestions.length > MAX_SUGGESTIONS_PER_ROUND) {
    throw new Error(`每轮最多提交 ${MAX_SUGGESTIONS_PER_ROUND} 条建议`)
  }
  for (const suggestion of input.suggestions) {
    if (suggestion.type !== 'plan' && suggestion.type !== 'action') throw new Error('type 必须是 plan 或 action')
    if (suggestion.type === 'plan' && (!suggestion.artifactHtml?.trim() || !suggestion.artifactName?.trim())) {
      throw new Error('plan 类型建议必须提交 artifactName 和 artifactHtml')
    }
    if (suggestion.suggestedAgentId) {
      const agent = agentStore.get(suggestion.suggestedAgentId)
      // 与前端口径一致：必须是本项目内且未隐藏的 Agent（隐藏 Agent 不在执行列表，推荐了用户也得重选）
      if (!agent || agent.project_id !== context.projectId || agent.hidden_at) {
        throw new Error(`推荐 Agent 必须是当前项目内可用 Agent（从推送包「项目可用 Agent」清单中选择，禁止编造 ID）: ${suggestion.suggestedAgentId}`)
      }
    }
  }

  const normalized: CreateAdvisorSuggestionInput[] = input.suggestions.map((suggestion) => ({
    type: suggestion.type,
    title: suggestion.title,
    descriptionMarkdown: suggestion.descriptionMarkdown,
    suggestedAgentId: suggestion.suggestedAgentId ?? null,
    agentReason: suggestion.agentReason ?? '',
    sourceEvidence: suggestion.sourceEvidence,
    artifact: null,
  }))
  const rows = advisorSuggestionStore.replaceRound(
    context.projectId,
    input.roundId,
    roundTriggerSessions.get(input.roundId)?.triggerSessionId ?? null,
    normalized,
  )
  // plan 建议落盘 + 注册预览通道（A-4/U-8）：不入库 HTML 内容，只存路径与 previewId
  for (let index = 0; index < rows.length; index += 1) {
    const suggestion = input.suggestions[index]
    if (suggestion.type !== 'plan' || !suggestion.artifactHtml || !suggestion.artifactName) continue
    const artifact = await saveAdvisorArtifact(context.projectId, rows[index].id, suggestion.artifactName, suggestion.artifactHtml)
    const preview = previewStore.create({
      projectId: context.projectId,
      title: suggestion.artifactName,
      sourcePath: artifact.absolutePath,
      entryFile: artifact.fileName,
      target: 'pc',
      description: 'AI 参谋建议附带产出',
    })
    advisorSuggestionStore.persistArtifact(rows[index].id, artifact, preview.id)
  }
  roundTriggerSessions.delete(input.roundId)
  projectAdvisorStore.update(context.projectId, { lastError: null })
  if (input.suggestions.length === 0 && input.noFindingReason?.trim()) {
    log.info({ projectId: context.projectId, roundId: input.roundId, reason: input.noFindingReason }, '参谋本轮无建议（无货沉默）')
  } else {
    log.info({ projectId: context.projectId, roundId: input.roundId, count: rows.length }, '参谋建议已提交')
  }
  emitUpdate(context.projectId)
  return { roundId: input.roundId, stored: rows.length, noFinding: rows.length === 0 }
}

async function saveAdvisorArtifact(projectId: string, suggestionId: string, artifactName: string, html: string): Promise<{ fileName: string; absolutePath: string; size: number }> {
  const dataDir = getDbPath()
  if (!dataDir) throw new Error('Database not initialized. Call initDatabase() first.')
  const safeName = (artifactName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'artifact').replace(/\.html$/i, '')
  const fileName = `${suggestionId}-${safeName}.html`
  const baseDir = resolve(dataDir, 'advisor-artifacts', projectId)
  await mkdir(baseDir, { recursive: true })
  const absolutePath = resolve(baseDir, fileName)
  await writeFile(absolutePath, html, 'utf8')
  return { fileName, absolutePath, size: Buffer.byteLength(html, 'utf8') }
}

export async function acceptSuggestion(
  projectId: string,
  suggestionId: string,
  input: {
    agentId?: string
    sessionId?: string
    sessionMode?: 'existing' | 'new_each'
    execute: boolean
    /** 执行弹窗可改标题/说明（U-13）：不传则用建议原文 */
    title?: string
    descriptionMarkdown?: string
  },
): Promise<AdvisorSuggestionView> {
  const suggestion = requireSuggestion(projectId, suggestionId)
  if (suggestion.task_id) return listAdvisorSuggestions(projectId)
  const agentId = input.agentId || suggestion.suggested_agent_id
  if (!agentId) throw new Error('该建议没有推荐 Agent，请手动选择执行 Agent')
  const agent = agentStore.get(agentId)
  // 与前端口径一致：执行 Agent 必须是本项目内且未隐藏的 Agent
  if (!agent || agent.project_id !== projectId || agent.hidden_at) throw new Error('执行 Agent 不属于当前项目或已隐藏')
  if (input.sessionId) {
    const session = sessionStore.get(input.sessionId)
    if (!session || session.agent_id !== agentId) throw new Error('执行会话不属于所选 Agent')
  }
  if (input.sessionMode === 'existing' && !input.sessionId) throw new Error('选择已有会话时必须选择执行会话')
  const taskTitle = input.title?.trim() || suggestion.title
  // 注入来源会话上下文：执行包只说「做什么」，来源对话才是「依据什么」（用户可编辑说明时以其为准，仍追加依据）
  const baseDescription = input.descriptionMarkdown?.trim() || suggestion.description_markdown
  const taskDescription = baseDescription + buildSourceContextBlock(suggestion)
  const token = `dispatch-${randomUUID()}`
  const claimed = advisorSuggestionStore.claimDispatch(suggestion.id, token)
  if (!claimed) throw new Error('建议正在创建任务，请稍候')
  try {
    let taskId: string
    let executionSessionId: string | null = input.sessionId ?? null
    if (input.execute) {
      const result = await createSimpleTask({
        title: taskTitle,
        description: taskDescription,
        assignee: agentId,
        projectId,
        source: 'advisor',
        sessionId: input.sessionId,
        sessionMode: input.sessionMode,
      })
      taskId = result.task.id
      executionSessionId = result.sessionId
    } else {
      // 只创建任务：草稿不派发，等用户在任务面板自行启动（与灵感候选任务同款语义）
      const task = await taskManager.createTask({
        title: taskTitle,
        description: taskDescription,
        projectId,
        source: 'advisor',
      })
      const resolvedSession = input.sessionMode
        ? await resolveTaskSession({ agentId, projectId, taskId: task.id, sessionId: input.sessionId, sessionMode: input.sessionMode })
        : null
      taskStepManager.addStep({
        taskId: task.id,
        title: taskTitle,
        description: taskDescription,
        assignee: agentId,
        sessionId: resolvedSession?.id ?? input.sessionId,
      })
      taskId = task.id
      executionSessionId = resolvedSession?.id ?? input.sessionId ?? null
    }
    advisorSuggestionStore.completeDispatch(
      suggestion.id,
      token,
      taskId,
      executionSessionId,
      input.execute ? 'accepted' : 'created',
    )
    emitUpdate(projectId)
    return listAdvisorSuggestions(projectId)
  } catch (err) {
    advisorSuggestionStore.releaseDispatch(suggestion.id, token)
    throw err
  }
}

export function ignoreSuggestion(projectId: string, suggestionId: string): AdvisorSuggestionView {
  const suggestion = requireSuggestion(projectId, suggestionId)
  if (!advisorSuggestionStore.ignore(suggestion.id)) throw new Error('建议不存在或已处理')
  emitUpdate(projectId)
  return listAdvisorSuggestions(projectId)
}

export function markAdvisorSuggestionsViewed(projectId: string, ids: string[] | null): number {
  requireProject(projectId)
  return advisorSuggestionStore.markViewed(projectId, ids)
}

export async function resumeProjectAdvisors(): Promise<void> {
  const released = advisorSuggestionStore.releaseStaleDispatches()
  if (released > 0) log.info({ released }, '服务重启后参谋派发占用已释放')
  for (const config of projectAdvisorStore.list()) {
    if (config.enabled && config.session_id && config.advisor_agent_id) {
      getRuntimeState(config.project_id)
    }
  }
}

function requireProject(projectId: string): void {
  if (!projectStore.get(projectId)) throw new Error('项目不存在')
}

function requireSuggestion(projectId: string, suggestionId: string): AdvisorSuggestionRow {
  const suggestion = advisorSuggestionStore.get(suggestionId)
  if (!suggestion || suggestion.project_id !== projectId) throw new Error('建议不存在或不属于当前项目')
  return suggestion
}

function findEnabledAdvisors(): ProjectAdvisorRow[] {
  return projectAdvisorStore.list().filter((row) => row.enabled === 1 && row.session_id && row.advisor_agent_id)
}

function emitUpdate(projectId: string): void {
  events.emit('advisor:update', { projectId })
}
