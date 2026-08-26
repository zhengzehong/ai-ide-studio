import { randomUUID } from 'node:crypto'
import { resolveInspirationTitle, type InspirationTitleMode } from '../shared/inspiration-title.js'
import { agentStore } from '../store/agents.js'
import { inspirationCandidateStore, inspirationNoteStore, type CreateCandidateInput } from '../store/inspiration-notes.js'
import { projectInspirationStore, type ProjectInspirationData } from '../store/project-inspirations.js'
import { projectStore } from '../store/projects.js'
import { sessionStore } from '../store/sessions.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { buildInspirationNoteData, type InspirationNoteData } from './project-inspiration-view.js'
import { sessionManager } from './sessions.js'
import { createSimpleTask } from './task-simple.js'
import { taskStepManager } from './task-steps.js'
import { taskManager } from './tasks.js'
import { loadStoredImagesForAcp, saveInspirationImages, type StoredImageAttachment } from './image-attachments.js'
import { buildInspirationAnalysisPrompt } from './project-inspiration-prompt.js'
import { enqueueProjectInspirationTurn } from './project-inspiration-turn-queue.js'
import type { ImageAttachment } from '../types/ws-protocol.js'

export { getInspirationNoteForSession, sendInspirationDiscussion } from './project-inspiration-discussion.js'

const log = createChildLogger('project-inspiration')
const MAX_NOTE_IMAGES = 10
const DEFAULT_PROMPT = [
  '你是当前项目的灵感整理助手。',
  '保留用户原意，先给出明确判断，再输出可执行方案、风险和需要确认的问题。',
  '只有内容足够明确时才生成候选任务；候选任务必须包含完整标题、任务说明、推荐 Agent 和推荐理由。',
  '不得直接创建或派发任务，必须调用 inspiration.analysis.publish 发布结构化结果，等待用户确认。',
].join('\n')

export interface ProjectInspirationWorkspace {
  config: ProjectInspirationData
  notes: InspirationNoteData[]
}

export interface PublishInspirationAnalysisInput {
  noteId: string
  expectedRevision: number
  summary: string
  bodyMarkdown: string
  questions: string[]
  candidates: CreateCandidateInput[]
}

export function getProjectInspiration(projectId: string): ProjectInspirationWorkspace {
  requireProject(projectId)
  const config = projectInspirationStore.ensure(projectId)
  return {
    config: projectInspirationStore.toData(config),
    notes: inspirationNoteStore.list(projectId).map(buildInspirationNoteData),
  }
}

export async function configureProjectInspiration(
  projectId: string,
  input: { organizerAgentId: string; organizationPrompt?: string; autoOrganize?: boolean },
): Promise<ProjectInspirationData> {
  requireProject(projectId)
  const agent = agentStore.get(input.organizerAgentId)
  if (!agent || agent.project_id !== projectId) throw new Error('整理 Agent 不属于当前项目')
  const current = projectInspirationStore.ensure(projectId)
  if (current.session_id && current.organizer_agent_id && current.organizer_agent_id !== agent.id) {
    throw new Error('更换整理 Agent 需要先重建灵感会话')
  }
  let sessionId = current.session_id
  const existingSession = sessionId ? sessionStore.get(sessionId) : undefined
  if (!existingSession || existingSession.deleted_at || existingSession.status !== 'active') {
    const session = await sessionManager.createSession(agent.id, undefined, projectId, 'conversation')
    sessionStore.updateTitle(session.id, '项目灵感会话')
    sessionId = session.id
  }
  const updated = projectInspirationStore.update(projectId, {
    organizerAgentId: agent.id,
    sessionId,
    organizationPrompt: input.organizationPrompt ?? (current.organization_prompt || DEFAULT_PROMPT),
    autoOrganize: input.autoOrganize,
    lastError: null,
  })
  if (sessionId !== current.session_id) inspirationNoteStore.requeueProcessing(projectId)
  emitUpdate(projectId)
  if (updated.auto_organize) scheduleDrain(projectId)
  log.info({ projectId, agentId: agent.id, sessionId }, '项目灵感整理器已配置')
  return projectInspirationStore.toData(updated)
}

export async function rebuildProjectInspirationSession(projectId: string, organizerAgentId: string): Promise<ProjectInspirationData> {
  const agent = agentStore.get(organizerAgentId)
  if (!agent || agent.project_id !== projectId) throw new Error('整理 Agent 不属于当前项目')
  const current = projectInspirationStore.ensure(projectId)
  const session = await sessionManager.createSession(agent.id, undefined, projectId, 'conversation')
  sessionStore.updateTitle(session.id, '项目灵感会话')
  const updated = projectInspirationStore.update(projectId, {
    organizerAgentId: agent.id,
    sessionId: session.id,
    lastError: null,
  })
  inspirationNoteStore.requeueProcessing(projectId)
  emitUpdate(projectId)
  if (updated.auto_organize) scheduleDrain(projectId)
  log.info({ projectId, agentId: agent.id, previousSessionId: current.session_id, sessionId: session.id }, '项目灵感会话已重建')
  return projectInspirationStore.toData(updated)
}

export async function createInspirationNote(
  projectId: string,
  input: { title?: string; titleMode?: InspirationTitleMode; sourceMarkdown: string; images?: ImageAttachment[] },
): Promise<InspirationNoteData> {
  requireProject(projectId)
  const config = projectInspirationStore.ensure(projectId)
  requireImageLimit(input.images?.length ?? 0)
  const queued = config.auto_organize === 1 && !!config.session_id && !!config.organizer_agent_id
  const noteId = `inspiration-${randomUUID().slice(0, 8)}`
  const attachments = await saveInspirationImages({ projectId, noteId, images: input.images })
  const resolvedTitle = resolveInspirationTitle(input)
  const note = inspirationNoteStore.create({
    id: noteId,
    projectId,
    title: resolvedTitle.title,
    titleMode: resolvedTitle.titleMode,
    sourceMarkdown: input.sourceMarkdown,
    attachments,
    queued,
  })
  emitUpdate(projectId, note.id)
  if (queued) scheduleDrain(projectId)
  log.info({ projectId, noteId: note.id, queued }, '项目灵感已创建')
  return buildInspirationNoteData(note)
}

export async function updateInspirationNote(
  projectId: string,
  noteId: string,
  input: { title?: string; titleMode?: InspirationTitleMode; sourceMarkdown: string; keepAttachmentPaths?: string[]; images?: ImageAttachment[] },
): Promise<InspirationNoteData> {
  const note = requireNote(projectId, noteId)
  const config = projectInspirationStore.ensure(projectId)
  const queue = config.auto_organize === 1 && !!config.session_id && !!config.organizer_agent_id
  const existingAttachments = parseStoredAttachments(note.attachments_json)
  const keepPaths = new Set(input.keepAttachmentPaths ?? existingAttachments.map((item) => item.relativePath))
  const keptAttachments = existingAttachments.filter((item) => keepPaths.has(item.relativePath))
  requireImageLimit(keptAttachments.length + (input.images?.length ?? 0))
  const newAttachments = await saveInspirationImages({ projectId, noteId, images: input.images })
  const resolvedTitle = resolveInspirationTitle({
    ...input,
    current: { title: note.title, titleMode: note.title_mode },
  })
  const updated = inspirationNoteStore.updateSource(note.id, {
    title: resolvedTitle.title,
    titleMode: resolvedTitle.titleMode,
    sourceMarkdown: input.sourceMarkdown,
    attachments: [...keptAttachments, ...newAttachments],
    queue,
  })
  if (!updated) throw new Error('灵感不存在')
  emitUpdate(projectId, note.id)
  if (queue) scheduleDrain(projectId)
  return buildInspirationNoteData(updated)
}

export function organizeInspirationNote(projectId: string, noteId: string): InspirationNoteData {
  const note = requireNote(projectId, noteId)
  requireConfigured(projectId)
  const queued = inspirationNoteStore.queue(note.id)
  if (!queued) throw new Error('灵感不存在')
  emitUpdate(projectId, note.id)
  scheduleDrain(projectId)
  return buildInspirationNoteData(queued)
}

export function getInspirationNote(projectId: string, noteId: string): InspirationNoteData {
  return buildInspirationNoteData(requireNote(projectId, noteId))
}

export function deleteInspirationNote(projectId: string, noteId: string): void {
  const note = requireNote(projectId, noteId)
  if (note.status === 'processing') throw new Error('灵感正在整理，暂时不能删除')
  if (!inspirationNoteStore.delete(note.id)) throw new Error('灵感删除失败')
  emitUpdate(projectId, note.id)
  log.info({ projectId, noteId }, '项目灵感已删除')
}

export function publishInspirationAnalysis(
  context: { projectId?: string; sessionId?: string },
  input: PublishInspirationAnalysisInput,
): { applied: boolean; note: InspirationNoteData } {
  if (!context.projectId || !context.sessionId) throw new Error('缺少项目或 Session 上下文')
  const config = projectInspirationStore.findBySession(context.sessionId)
  if (!config || config.project_id !== context.projectId) throw new Error('当前 Session 不是项目灵感会话')
  const note = requireNote(context.projectId, input.noteId)
  for (const candidate of input.candidates) {
    if (!candidate.suggestedAgentId) continue
    const agent = agentStore.get(candidate.suggestedAgentId)
    if (!agent || agent.project_id !== context.projectId) throw new Error(`推荐 Agent 不属于当前项目: ${candidate.suggestedAgentId}`)
  }
  const result = inspirationNoteStore.stageAnalysis(
    note.id,
    input.expectedRevision,
    input,
  )
  const current = result.note ?? inspirationNoteStore.get(note.id)
  if (!current) throw new Error('灵感不存在')
  if (!result.staged) throw new Error(result.reason ?? 'ANALYSIS_STAGE_FAILED')
  if (result.staged) {
    projectInspirationStore.update(context.projectId, { lastError: null })
    log.debug(
      { projectId: context.projectId, noteId: note.id, revision: input.expectedRevision },
      '灵感整理结果已暂存',
    )
  }
  return { applied: result.staged, note: buildInspirationNoteData(current) }
}

export function updateInspirationCandidate(
  projectId: string,
  candidateId: string,
  input: { title: string; descriptionMarkdown: string; suggestedAgentId?: string | null },
): InspirationNoteData {
  const candidate = requireCandidate(projectId, candidateId)
  if (input.suggestedAgentId) requireProjectAgent(projectId, input.suggestedAgentId)
  const updated = inspirationCandidateStore.update(candidate.id, input)
  if (!updated) throw new Error('候选任务已创建或正在派发，不能再编辑')
  const note = requireNote(projectId, candidate.note_id)
  emitUpdate(projectId, note.id)
  return buildInspirationNoteData(note)
}

export async function createTaskFromInspirationCandidate(
  projectId: string,
  candidateId: string,
  input: { agentId: string; execute: boolean },
): Promise<InspirationNoteData> {
  const candidate = requireCandidate(projectId, candidateId)
  if (candidate.task_id) return buildInspirationNoteData(requireNote(projectId, candidate.note_id))
  const note = requireNote(projectId, candidate.note_id)
  if (candidate.analysis_revision !== note.analysis_revision) throw new Error('候选任务已过期，请使用最新整理结果')
  requireProjectAgent(projectId, input.agentId)
  const token = `dispatch-${randomUUID()}`
  if (!inspirationCandidateStore.claimDispatch(candidate.id, token)) throw new Error('候选任务正在创建，请稍候')
  try {
    if (input.execute) {
      const result = await createSimpleTask({
        title: candidate.title,
        description: candidate.description_markdown,
        assignee: input.agentId,
        projectId,
        source: 'inspiration',
      })
      inspirationCandidateStore.completeDispatch(candidate.id, token, result.task.id, result.sessionId)
    } else {
      const task = await taskStoreCreateDraft(candidate.title, candidate.description_markdown, projectId, input.agentId)
      inspirationCandidateStore.completeDispatch(candidate.id, token, task.id)
    }
    emitUpdate(projectId, note.id)
    return buildInspirationNoteData(requireNote(projectId, note.id))
  } catch (err) {
    inspirationCandidateStore.releaseDispatch(candidate.id, token)
    throw err
  }
}

export async function resumeProjectInspirations(): Promise<void> {
  const requeued = inspirationNoteStore.requeueProcessing()
  const releasedDispatches = inspirationCandidateStore.releaseStaleDispatches()
  if (requeued > 0) log.info({ requeued }, '服务重启后灵感整理重新排队')
  if (releasedDispatches > 0) log.info({ releasedDispatches }, '服务重启后灵感候选任务派发占用已释放')
  for (const config of projectInspirationStore.list()) {
    if (config.auto_organize && config.session_id && config.organizer_agent_id) scheduleDrain(config.project_id)
  }
}

async function taskStoreCreateDraft(title: string, description: string, projectId: string, agentId: string) {
  const task = await taskManager.createTask({ title, description, projectId, source: 'inspiration' })
  taskStepManager.addStep({ taskId: task.id, title, description, assignee: agentId })
  return task
}

function scheduleDrain(projectId: string): void {
  void enqueueProjectInspirationTurn(projectId, () => drainProjectNow(projectId)).catch((err: unknown) => {
    log.error({ err, projectId }, '灵感整理队列执行失败')
  })
}

async function drainProjectNow(projectId: string): Promise<void> {
  while (true) {
    const config = projectInspirationStore.get(projectId)
    if (!config?.auto_organize || !config.session_id || !config.organizer_agent_id) return
    const note = inspirationNoteStore.claimNext(projectId)
    if (!note) return
    const attemptId = note.analysis_attempt_id
    if (!attemptId) {
      inspirationNoteStore.markFailed(note.id, note.analysis_revision, '灵感整理 attempt 创建失败')
      continue
    }
    emitUpdate(projectId, note.id)
    try {
      const attachments = parseStoredAttachments(note.attachments_json)
      const images = await loadStoredImagesForAcp(attachments)
      await sessionManager.enqueuePrompt(config.session_id, buildInspirationAnalysisPrompt(config.organization_prompt || DEFAULT_PROMPT, note, attachments), images, {
        senderRole: 'inspiration',
        senderId: note.id,
        senderName: '灵感整理',
        batchKey: `inspiration-organize:${note.id}:${note.analysis_revision}`,
        dedupeKey: `inspiration:${note.id}:${note.analysis_revision}`,
      })
      if (inspirationNoteStore.finalizeAnalysis(note.id, note.analysis_revision, attemptId)) {
        projectInspirationStore.update(projectId, { lastError: null })
        log.info({ projectId, noteId: note.id, revision: note.analysis_revision, attemptId }, '灵感整理结果已提交')
      } else {
        inspirationNoteStore.markFailed(note.id, note.analysis_revision, 'AI 未发布有效的结构化整理结果', attemptId)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const failed = inspirationNoteStore.markFailed(note.id, note.analysis_revision, message, attemptId)
      if (failed) {
        projectInspirationStore.update(projectId, { lastError: message })
        log.error({ err, projectId, noteId: note.id, revision: note.analysis_revision, attemptId }, '灵感整理失败')
      } else {
        log.info(
          { projectId, noteId: note.id, revision: note.analysis_revision, attemptId },
          '旧灵感整理轮次失败已忽略',
        )
      }
    }
    emitUpdate(projectId, note.id)
  }
}

function parseStoredAttachments(value: string): StoredImageAttachment[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is StoredImageAttachment => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false
      const row = item as Record<string, unknown>
      return typeof row.relativePath === 'string'
        && typeof row.path === 'string'
        && typeof row.mimeType === 'string'
        && typeof row.url === 'string'
        && typeof row.size === 'number'
        && typeof row.order === 'number'
    })
  } catch {
    return []
  }
}

function requireProject(projectId: string): void {
  if (!projectStore.get(projectId)) throw new Error('项目不存在')
}

function requireConfigured(projectId: string) {
  const config = projectInspirationStore.get(projectId)
  if (!config?.organizer_agent_id || !config.session_id) throw new Error('请先配置项目灵感整理 Agent')
  return config
}

function requireNote(projectId: string, noteId: string) {
  const note = inspirationNoteStore.get(noteId)
  if (!note || note.project_id !== projectId) throw new Error('灵感不存在或不属于当前项目')
  return note
}

function requireCandidate(projectId: string, candidateId: string) {
  const candidate = inspirationCandidateStore.get(candidateId)
  if (!candidate) throw new Error('候选任务不存在')
  requireNote(projectId, candidate.note_id)
  return candidate
}

function requireProjectAgent(projectId: string, agentId: string): void {
  const agent = agentStore.get(agentId)
  if (!agent || agent.project_id !== projectId) throw new Error('执行 Agent 不属于当前项目')
}

function emitUpdate(projectId: string, noteId?: string): void {
  events.emit('inspiration:update', { projectId, noteId })
}

function requireImageLimit(count: number): void {
  if (count > MAX_NOTE_IMAGES) throw new Error(`每条灵感最多保存 ${MAX_NOTE_IMAGES} 张图片`)
}
