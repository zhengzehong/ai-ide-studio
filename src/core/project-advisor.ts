import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { agentStore } from '../store/agents.js'
import { getDbPath } from '../store/db.js'
import { projectStore } from '../store/projects.js'
import { sessionStore } from '../store/sessions.js'
import { previewStore } from '../store/previews.js'
import { projectAdvisorStore, type ProjectAdvisorRow } from '../store/advisors.js'
import {
  advisorSuggestionStore,
  suggestionExpiresAt,
  type AdvisorArtifact,
  type AdvisorSourceEvidence,
  type AdvisorSuggestionRow,
  type CreateAdvisorSuggestionInput,
  type AdvisorSuggestionType,
} from '../store/advisor-suggestions.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { DEFAULT_ADVISOR_PROMPT } from './advisor-prompt.js'
import { resetAdvisorScheduling } from './advisor-turns.js'
import { requireAdvisorRound, markAdvisorRoundSubmitted, invalidateAdvisorRounds } from './advisor-rounds.js'
import { buildSourceContextBlock } from './advisor-suggestion-context.js'
export { handleSessionTurnDone } from './advisor-turns.js'
import { sessionManager } from './sessions.js'
import { resolveTaskSession, taskManager } from './tasks.js'
import { taskStepManager } from './task-steps.js'
import { createSimpleTask } from './task-simple.js'

const log = createChildLogger('project-advisor')

export { DEFAULT_ADVISOR_PROMPT } from './advisor-prompt.js'

const MAX_SUGGESTIONS_PER_ROUND = 3
type AdvisorConfiguration = ReturnType<typeof projectAdvisorStore.toData> & { defaultAdvisorPrompt: string }
function advisorConfiguration(row: ProjectAdvisorRow): AdvisorConfiguration {
  return { ...projectAdvisorStore.toData(row), defaultAdvisorPrompt: DEFAULT_ADVISOR_PROMPT }
}

export interface AdvisorSuggestionView {
  serverNow: string
  suggestions: AdvisorSuggestionRow[]
  expired: AdvisorSuggestionRow[]
  settled: AdvisorSuggestionRow[]
  pendingCount: number
}

export function getAdvisorWorkspace(projectId: string): { config: AdvisorConfiguration; suggestions: AdvisorSuggestionView } {
  requireProject(projectId)
  const config = ensureProjectAdvisorRow(projectId)
  return {
    config: advisorConfiguration(config),
    suggestions: listAdvisorSuggestions(projectId),
  }
}

function listAdvisorSuggestions(projectId: string): AdvisorSuggestionView {
  const now = new Date().toISOString()
  return {
    serverNow: now,
    suggestions: advisorSuggestionStore.listActive(projectId, now),
    expired: [],
    settled: advisorSuggestionStore.listSettled(projectId, now),
    pendingCount: advisorSuggestionStore.countPending(projectId, now),
  }
}

export function listAdvisorSuggestionsFor(projectId: string): AdvisorSuggestionView {
  return listAdvisorSuggestions(projectId)
}

/** 首次访问自动建默认配置（U-22）；专属会话惰性创建（配置了 Agent 后） */
export function ensureProjectAdvisorRow(projectId: string): ProjectAdvisorRow {
  return projectAdvisorStore.ensure(projectId)
}

export async function configureAdvisor(
  projectId: string,
  input: {
    advisorAgentId: string
    advisorPrompt?: string
    minSilenceMinutes?: number
    enabled?: boolean
  },
): Promise<AdvisorConfiguration> {
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
    advisorPrompt: input.advisorPrompt,
    minSilenceMinutes: input.minSilenceMinutes,
    enabled: input.enabled,
    lastError: null,
  })
  if (!updated.enabled || current.session_id !== sessionId) {
    resetAdvisorScheduling(projectId)
    if (current.session_id) invalidateAdvisorRounds(current.session_id)
  }
  emitUpdate(projectId)
  log.info({ projectId, agentId: input.advisorAgentId, sessionId }, '项目参谋已配置')
  return advisorConfiguration(updated)
}

export async function rebuildAdvisorSession(projectId: string, advisorAgentId: string): Promise<AdvisorConfiguration> {
  const agent = agentStore.get(advisorAgentId)
  if (!agent) throw new Error('参谋 Agent 不存在')
  if (agent.project_id && agent.project_id !== projectId) throw new Error('参谋 Agent 不属于当前项目')
  const previous = projectAdvisorStore.get(projectId)
  const session = await sessionManager.createSession(advisorAgentId, undefined, projectId, 'conversation')
  sessionStore.updateTitle(session.id, '项目参谋会话')
  const updated = projectAdvisorStore.update(projectId, {
    advisorAgentId,
    sessionId: session.id,
    lastError: null,
  })
  resetAdvisorScheduling(projectId)
  if (previous?.session_id) invalidateAdvisorRounds(previous.session_id)
  emitUpdate(projectId)
  log.info({ projectId, advisorAgentId, sessionId: session.id }, '项目参谋会话已重建')
  return advisorConfiguration(updated)
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
  if (!config.enabled) throw new Error('参谋已禁用')
  const round = requireAdvisorRound(input.roundId, context.projectId, context.sessionId)
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
    round.triggerSessionId,
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
  markAdvisorRoundSubmitted(input.roundId)
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
  if (Date.parse(suggestionExpiresAt(suggestion)) <= Date.now()) throw new Error('建议已过期')
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
  if (!claimed) throw new Error('建议已处理、已过期或正在创建任务，请刷新列表')
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
  if (suggestion.status === 'ignored') return listAdvisorSuggestions(projectId)
  if (!advisorSuggestionStore.ignore(suggestion.id)) throw new Error('建议已处理、已过期或正在创建任务')
  log.info({ projectId, suggestionId }, '参谋建议已忽略')
  emitUpdate(projectId)
  return listAdvisorSuggestions(projectId)
}

export function ignoreSuggestions(projectId: string, ids: string[]): { ignoredCount: number; suggestions: AdvisorSuggestionView } {
  requireProject(projectId)
  const ignoredCount = advisorSuggestionStore.ignoreMany(projectId, ids)
  log.info({ projectId, requestedCount: ids.length, ignoredCount }, '参谋建议已批量忽略')
  emitUpdate(projectId)
  return { ignoredCount, suggestions: listAdvisorSuggestions(projectId) }
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

}

function requireProject(projectId: string): void {
  if (!projectStore.get(projectId)) throw new Error('项目不存在')
}

function requireSuggestion(projectId: string, suggestionId: string): AdvisorSuggestionRow {
  const suggestion = advisorSuggestionStore.get(suggestionId)
  if (!suggestion || suggestion.project_id !== projectId) throw new Error('建议不存在或不属于当前项目')
  return suggestion
}

function emitUpdate(projectId: string): void {
  events.emit('advisor:update', { projectId })
}
