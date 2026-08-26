import {
  configureProjectInspiration,
  createInspirationNote,
  createTaskFromInspirationCandidate,
  deleteInspirationNote,
  getInspirationNote,
  getProjectInspiration,
  organizeInspirationNote,
  rebuildProjectInspirationSession,
  setInspirationNoteCompleted,
  updateInspirationCandidate,
  updateInspirationNote,
} from '../../core/project-inspiration.js'
import type { ImageAttachment } from '../../types/ws-protocol.js'
import type { RpcHandlerMap } from './types.js'

export const inspirationRpcHandlers: RpcHandlerMap = {
  'inspiration.get'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(getProjectInspiration(requiredText(msg.projectId, 'projectId')))
  },

  async 'inspiration.configure'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(await configureProjectInspiration(requiredText(msg.projectId, 'projectId'), {
      organizerAgentId: requiredText(msg.organizerAgentId, 'organizerAgentId'),
      organizationPrompt: optionalText(msg.organizationPrompt, 20_000),
      autoOrganize: optionalBoolean(msg.autoOrganize, 'autoOrganize'),
    }))
  },

  async 'inspiration.session.rebuild'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(await rebuildProjectInspirationSession(
      requiredText(msg.projectId, 'projectId'),
      requiredText(msg.organizerAgentId, 'organizerAgentId'),
    ))
  },

  async 'inspiration.note.create'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(await createInspirationNote(requiredText(msg.projectId, 'projectId'), {
      title: optionalText(msg.title, 160),
      titleMode: optionalTitleMode(msg.titleMode),
      sourceMarkdown: requiredText(msg.sourceMarkdown, 'sourceMarkdown', 50_000),
      images: optionalImages(msg.images),
    }))
  },

  async 'inspiration.note.update'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(await updateInspirationNote(
      requiredText(msg.projectId, 'projectId'),
      requiredText(msg.noteId, 'noteId'),
      {
        title: optionalText(msg.title, 160),
        titleMode: optionalTitleMode(msg.titleMode),
        sourceMarkdown: requiredText(msg.sourceMarkdown, 'sourceMarkdown', 50_000),
        keepAttachmentPaths: optionalStringArray(msg.keepAttachmentPaths, 'keepAttachmentPaths', 20, 500),
        images: optionalImages(msg.images),
      },
    ))
  },

  'inspiration.note.get'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(getInspirationNote(requiredText(msg.projectId, 'projectId'), requiredText(msg.noteId, 'noteId')))
  },

  'inspiration.note.organize'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(organizeInspirationNote(requiredText(msg.projectId, 'projectId'), requiredText(msg.noteId, 'noteId')))
  },

  'inspiration.note.setCompleted'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(setInspirationNoteCompleted(
      requiredText(msg.projectId, 'projectId'),
      requiredText(msg.noteId, 'noteId'),
      requiredBoolean(msg.completed, 'completed'),
    ))
  },

  'inspiration.note.delete'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const projectId = requiredText(msg.projectId, 'projectId')
    const noteId = requiredText(msg.noteId, 'noteId')
    deleteInspirationNote(projectId, noteId)
    sendResult({ deleted: true, noteId })
  },

  'inspiration.candidate.update'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(updateInspirationCandidate(
      requiredText(msg.projectId, 'projectId'),
      requiredText(msg.candidateId, 'candidateId'),
      {
        title: requiredText(msg.title, 'title', 160),
        descriptionMarkdown: requiredText(msg.descriptionMarkdown, 'descriptionMarkdown', 20_000),
        suggestedAgentId: optionalText(msg.suggestedAgentId, 120),
      },
    ))
  },

  async 'inspiration.candidate.createTask'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(await createTaskFromInspirationCandidate(
      requiredText(msg.projectId, 'projectId'),
      requiredText(msg.candidateId, 'candidateId'),
      {
        agentId: requiredText(msg.agentId, 'agentId'),
        execute: requiredBoolean(msg.execute, 'execute'),
      },
    ))
  },
}

function requireOwner(authMode: 'owner' | 'guest'): void {
  if (authMode !== 'owner') throw new Error('访客无权访问项目灵感')
}

function requiredText(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 不能为空`)
  const text = value.trim()
  if (text.length > maxLength) throw new Error(`${field} 最多 ${maxLength} 个字符`)
  return text
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.trim().length > maxLength) throw new Error(`文本最多 ${maxLength} 个字符`)
  return value.trim()
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} 必须是布尔值`)
  return value
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  return value === undefined ? undefined : requiredBoolean(value, field)
}

function optionalTitleMode(value: unknown): 'auto' | 'manual' | undefined {
  if (value === undefined) return undefined
  if (value === 'auto' || value === 'manual') return value
  throw new Error('titleMode 必须是 auto 或 manual')
}

function optionalStringArray(
  value: unknown,
  field: string,
  maxItems: number,
  maxLength: number,
): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${field} 格式错误`)
  return value.map((item, index) => requiredText(item, `${field}[${index}]`, maxLength))
}

function optionalImages(value: unknown): ImageAttachment[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 10) throw new Error('images 最多 10 项')
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`images[${index}] 格式错误`)
    const record = item as Record<string, unknown>
    const data = requiredText(record.data, `images[${index}].data`, 15_000_000)
    const mimeType = requiredText(record.mimeType, `images[${index}].mimeType`, 100)
    if (!mimeType.startsWith('image/')) throw new Error(`images[${index}] 不是图片`)
    return { data, mimeType, name: optionalText(record.name, 500) }
  })
}
