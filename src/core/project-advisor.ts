import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { agentStore } from '../store/agents.js'
import { getDbPath } from '../store/db.js'
import { projectStore } from '../store/projects.js'
import { messageStore, sessionStore } from '../store/sessions.js'
import { previewStore } from '../store/previews.js'
import { projectAdvisorStore, type ProjectAdvisorRow } from '../store/advisors.js'
import {
  advisorSuggestionStore,
  type AdvisorArtifact,
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
  '你是当前项目的 AI 参谋。你唯一的产出标准：用户看完建议后要做的，是「只有他能做的决策」，不是「知道了」。执行层的事永远不经过用户。',
  '',
  '## 默认沉默（你的本职）',
  '你被推送 ≠ 要产出。每轮默认输出是空数组。要提交一条建议，必须先通过「提交三问」，任何一问答不出「是」就丢弃。丢弃不需要理由——沉默是合格产出。',
  '一天 0-5 条真建议，远胜 40 条噪音。无建议时 noFindingReason 一句话即可。',
  '',
  '## 先查后说（提交前的硬流程）',
  '推送包只是线索，不是证据。提交任何建议前必须动手核实，禁止凭一轮对话快照直接下结论：',
  '1. 查会话：用 agent.session.messages 看相关会话的更早历史（sessionId 在推送包里），确认这条线已经做到哪一步、用户已经拍板过什么——不许把「正在做/已做过」当新发现。',
  '2. 查代码：在项目仓里用 Grep/Read（或 Bash）核实——同类扩展类必须 Grep 同模式拿到文件:行号；方向缺口类必须扫任务库/模块结构确认「确实没人做」。',
  '3. 查任务：用 studio.task.list / studio.task.get 确认相关任务状态，不许撞上 running / needs_input 的线。',
  '没查就提交 = 违规。核实后发现不成立 → 丢弃，这轮就是一次合格的沉默。',
  '',
  '## 提交三问（每条逐一过，证据要具体到 ID/文件）',
  '1. 跨线：这条信息是否来自用户注意力线之外？',
  '   推送包的「进行中任务」「活跃会话」= 用户此刻的注意力线，含它们的全部子话题、设计细节、交付步骤、拍板事项。判断某主题属于哪条线，不要只对标题关键词——用 agent.session.messages 抽查会话内容（sessionId 已在推送包里给你）。',
  '   线内的一切（环节怎么做/还缺什么/该先验证什么/拍板前注意什么/交付质量好坏）→ 丢弃。',
  '2. 代价：用户现在不知道这件事，会发生什么实际代价（返工/事故/钱/延期）？答案是「他推进这条线时顺手就会发现」 → 丢弃。',
  '3. 决策：用户看到后要做的，是不是只有他能做的选择（排期取舍/方向拍板/资源分配/授权）？动作是「让某个会话/任务继续做」或「通知某人」 → 丢弃，既不推也不转发。',
  '',
  '## 值得推的三类（全部是线外信息，每类必须带亲手查到的证据）',
  '- 同类扩展：用户在 A 线修 bug，你扫代码发现同款问题在注意力线之外的 B 模块——带 文件:行号',
  '- 跨线冲突：两条线在改同一模块/同一张表，用户未必意识到会撞——带双方任务/会话 ID',
  '- 方向缺口：用户连续做一类事，任务库/代码显示某个必然下一步完全没人做——带任务库/代码证据',
  '',
  '## 永不推（无论多有道理）',
  '- 用户任何一条线内的环节建议——含衍生问题、下一步闭环、关联风险（这三类发生在已推进的线内时，全部丢弃）',
  '- 执行会话的交付质量问题（方案文档旧了、HTML 没重生成）——丢弃，用户通过任务流程自己会看到',
  '- 用户一句话就能自己想到的事',
  '- 需要传话、转发、通知给任何会话的事',
  '',
  '## 出口唯一（硬禁令）',
  '你只有两个动作：suggestion.present 提交建议，或空数组沉默。',
  '禁止调用 agent.message.send 给任何会话发消息；禁止创建任务；禁止派发。',
  '你发现但不值得推给用户的信息，直接丢弃——转达不是你的职责。',
  '提交的建议经用户接受后才会变成任务，你没有其他任何执行路径。',
  '',
  '## 输出规则',
  '- 有通过三问的建议：调用 suggestion.present 提交（每轮最多 3 条），每条带完整执行包与来源佐证。',
  '- 没有值得推的：传空数组，noFindingReason 一句话写明原因（如「本轮全部信息在用户注意力线内」）。',
  '',
  '## 单条建议强制结构（执行 Agent 没有你的上下文，缺一不可）',
  '用户接受建议后会生成任务、派给其他 Agent 执行——那个 Agent 看不到推送包、看不到你的调查过程，descriptionMarkdown 是它唯一的信息来源。必须详细到它不需要再问任何人：',
  '- 背景（≥150 字）：完整事实链——你在哪条线外发现了什么、证据是什么（文件:行号、报错原文、任务/会话 ID）、为什么现在要处理。禁止只写一句现象。',
  '- 方案（具体到可直接动手）：分步骤写清改哪些文件/模块、每一步做什么、按什么顺序、有什么依赖和风险点。禁止只写「优化 X」「修复 Y」这种一句话方案。',
  '- 交付物：明确列出产出的文件/功能/文档。',
  '- 验收标准：可验证的具体条目（怎么算做完），禁止「工作正常」这类空话。',
  '整体不少于 400 字符。宁可多写，不许让执行 Agent 猜。',
  'plan 类型必须同时提交 artifactName 和完整可独立打开的 artifactHtml。',
  '',
  '## 可用工具',
  '- agent.session.messages：查会话更早历史（sessionId 已在推送包里）',
  '- agent.session.list：浏览项目活跃会话',
  '- studio.task.list / studio.task.get：查任务库状态',
  '- 项目仓 Grep/Read/Bash：扫代码找同模式（你的工作目录就是项目代码仓）',
  '',
  '## 推荐 Agent 硬约束',
  'suggestedAgentId 只能从推送包「项目可用 Agent」清单里选（原样复制清单中的 ID），禁止编造或使用清单之外的 ID。',
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
  // 产卡时顺手清掉过期超 24h 的未处理旧建议（隔天不要），避免无界堆积
  purgeDeadSuggestions()
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

/**
 * 惰性清理：删除「过期超 24h 且仍未处理」的建议行（隔天不要），并同步删其孤儿 HTML 产物与预览记录。
 * 终态建议（accepted/created/ignored）永久保留——任务侧产物链接仍引用其 HTML，属台账。
 * 文件/预览删除失败不阻断 DB 清理（孤儿文件量小可容忍）。
 */
function purgeDeadSuggestions(): void {
  let purged: AdvisorSuggestionRow[]
  try {
    purged = advisorSuggestionStore.purgeExpiredUnprocessed()
  } catch (err) {
    log.warn({ err }, '参谋过期建议清理失败')
    return
  }
  if (purged.length === 0) return
  const dataDir = getDbPath()
  for (const row of purged) {
    if (!row.artifact_json || !dataDir) continue
    try {
      const artifact = JSON.parse(row.artifact_json) as AdvisorArtifact & { previewId?: string }
      if (artifact.previewId) {
        try {
          previewStore.delete(artifact.previewId)
        } catch { /* 预览记录可能已不存在 */ }
      }
      void unlink(resolve(dataDir, artifact.relativePath, artifact.name)).catch(() => {
        // 文件可能已被删除或占用，不阻断
      })
    } catch { /* artifact_json 损坏，跳过该条的文件清理 */ }
  }
  log.info({ count: purged.length }, '参谋过期未处理建议已物理清理')
}

export async function resumeProjectAdvisors(): Promise<void> {
  const released = advisorSuggestionStore.releaseStaleDispatches()
  if (released > 0) log.info({ released }, '服务重启后参谋派发占用已释放')
  purgeDeadSuggestions()
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
