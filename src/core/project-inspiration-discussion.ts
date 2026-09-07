import { projectInspirationStore } from '../store/project-inspirations.js'
import { inspirationNoteStore } from '../store/inspiration-notes.js'
import { sessionStore } from '../store/sessions.js'
import type { ImageAttachment } from '../types/ws-protocol.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { buildInspirationDiscussionPrompt } from './project-inspiration-prompt.js'
import { enqueueProjectInspirationTurn } from './project-inspiration-turn-queue.js'
import { buildInspirationNoteData, type InspirationNoteData } from './project-inspiration-view.js'
import { sessionManager } from './sessions.js'

const log = createChildLogger('project-inspiration-discussion')

export function getInspirationNoteForSession(
  context: { projectId?: string; sessionId?: string },
  noteId: string,
): InspirationNoteData {
  const projectId = requireInspirationSession(context)
  const note = inspirationNoteStore.get(noteId)
  if (!note || note.project_id !== projectId) throw new Error('灵感不存在或不属于当前项目')
  return buildInspirationNoteData(note)
}

export async function sendInspirationDiscussion(input: {
  sessionId: string
  noteId: string
  content: string
  images?: ImageAttachment[]
  clientMessageId: string
  contextProjectId?: string
  originDeviceId?: string
}): Promise<void> {
  const session = sessionStore.get(input.sessionId)
  if (!session?.project_id) throw new Error('灵感会话不存在')
  if (input.contextProjectId && input.contextProjectId !== session.project_id) throw new Error('灵感会话不属于当前项目')
  const config = projectInspirationStore.findBySession(input.sessionId)
  if (!config || config.project_id !== session.project_id) throw new Error('当前 Session 不是项目灵感会话')
  const projectId = session.project_id
  return enqueueProjectInspirationTurn(projectId, async () => {
    const note = inspirationNoteStore.get(input.noteId)
    if (!note || note.project_id !== projectId) throw new Error('灵感不存在或不属于当前项目')
    const baseRevision = note.analysis_revision
    const started = inspirationNoteStore.beginDiscussion(note.id, baseRevision)
    if (!started?.analysis_attempt_id) throw new Error('这条灵感正在整理或讨论，请稍后再试')
    const attemptId = started.analysis_attempt_id
    log.debug({ projectId, sessionId: input.sessionId, noteId: note.id, baseRevision, attemptId }, '灵感讨论开始')
    try {
      await sessionManager.sendPrompt(input.sessionId, input.content, input.images, {
        clientMessageId: input.clientMessageId,
        originDeviceId: input.originDeviceId,
        batchKey: `inspiration-discussion:${input.noteId}:${input.clientMessageId}`,
        modelContent: buildInspirationDiscussionPrompt(input.noteId, input.content),
      })
      const revised = inspirationNoteStore.finalizeAnalysis(note.id, baseRevision, attemptId)
      if (!revised) {
        inspirationNoteStore.discardDiscussion(note.id, attemptId)
      }
      log.info(
        { projectId, sessionId: input.sessionId, noteId: note.id, baseRevision, attemptId, revised },
        revised ? '灵感讨论方案已更新' : '灵感讨论完成，原方案保持不变',
      )
    } catch (error) {
      inspirationNoteStore.discardDiscussion(note.id, attemptId)
      log.warn({ err: error, projectId, sessionId: input.sessionId, noteId: note.id, baseRevision, attemptId }, '灵感讨论失败，已丢弃修订草稿')
      throw error
    } finally {
      events.emit('inspiration:update', { projectId, noteId: note.id })
    }
  })
}

function requireInspirationSession(context: { projectId?: string; sessionId?: string }): string {
  if (!context.projectId || !context.sessionId) throw new Error('缺少项目或 Session 上下文')
  const config = projectInspirationStore.findBySession(context.sessionId)
  if (!config || config.project_id !== context.projectId) throw new Error('当前 Session 不是项目灵感会话')
  return context.projectId
}
