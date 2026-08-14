import { isAbsolute } from 'node:path'
import { relative, resolve, sep } from 'node:path'
import { realpathSync } from 'node:fs'
import { inspectFile, isHiddenPathRel } from '../../../core/filesystem.js'
import { events } from '../../../core/events.js'
import { projectSecretaryStore } from '../../../store/project-secretaries.js'
import { secretaryMailStore, type SecretaryAttachment } from '../../../store/secretary-mail.js'
import { sessionStore } from '../../../store/sessions.js'
import type { ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../../types.js'

const MAX_MARKDOWN_LENGTH = 100_000
const MAX_ATTACHMENTS = 20

export const secretaryReportHandler: ToolHandler = {
  name: 'secretary.report',
  description: '向当前项目秘书邮箱新建或更新一封主题邮件，可附带多个项目内文件。',
  inputSchema: {
    type: 'object',
    properties: {
      threadKey: { type: 'string', maxLength: 160, description: '同一主题后续更新时复用此键' },
      subject: { type: 'string', maxLength: 160 },
      summary: { type: 'string', maxLength: 800 },
      kind: { type: 'string', enum: ['decision', 'result', 'progress', 'alert', 'digest'] },
      priority: { type: 'string', enum: ['low', 'normal', 'high'] },
      needsAction: { type: 'boolean' },
      markdown: { type: 'string', maxLength: MAX_MARKDOWN_LENGTH },
      sourceRefs: { type: 'array', items: { type: 'string' }, maxItems: 50 },
      attachments: {
        type: 'array',
        maxItems: MAX_ATTACHMENTS,
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '当前项目内相对文件路径' },
            title: { type: 'string', maxLength: 160 },
          },
          required: ['path'],
        },
      },
    },
    required: ['subject', 'markdown'],
  },

  async execute(input: ToolHandlerInput, context): Promise<ToolHandlerResult> {
    if (!context.sessionId || !context.projectId || !context.workDir) throw new Error('秘书工具缺少项目 Session 上下文')
    const secretary = projectSecretaryStore.findBySession(context.sessionId)
    const session = sessionStore.get(context.sessionId)
    if (!secretary || secretary.project_id !== context.projectId || !session
      || (session.purpose !== 'secretary_runtime' && session.purpose !== 'secretary_chat')
      || session.deleted_at !== null
      || (context.agentId && context.agentId !== session.agent_id)) {
      throw new Error('当前 Session 不是项目秘书 Session')
    }
    const subject = requiredText(input.subject, 'subject', 160)
    const markdown = requiredText(input.markdown, 'markdown', MAX_MARKDOWN_LENGTH)
    const attachments = input.attachments === undefined ? undefined : parseAttachments(input.attachments, context.workDir)
    const threadKey = optionalText(input.threadKey, 160) ?? subject
    const thread = secretaryMailStore.upsert({
      secretaryId: secretary.id,
      threadKey,
      subject,
      summary: optionalText(input.summary, 800),
      kind: enumText(input.kind, ['decision', 'result', 'progress', 'alert', 'digest']) ?? 'result',
      priority: enumText(input.priority, ['low', 'normal', 'high']) ?? 'normal',
      needsAction: typeof input.needsAction === 'boolean' ? input.needsAction : false,
      bodyMarkdown: markdown,
      sourceRefs: parseStringArray(input.sourceRefs),
      attachments,
    })
    secretaryMailStore.appendEntry(thread.id, 'secretary', markdown)
    events.emit('secretary:update', { projectId: secretary.project_id })
    return jsonResult({ threadId: thread.id, secretaryId: secretary.id, updatedAt: thread.updatedAt })
  },
}

function parseAttachments(value: unknown, workDir: string): SecretaryAttachment[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) throw new Error(`attachments 最多 ${MAX_ATTACHMENTS} 个文件`)
  const seen = new Set<string>()
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`attachments[${index}] 格式错误`)
    const record = item as Record<string, unknown>
    const path = requiredText(record.path, `attachments[${index}].path`, 500).replace(/\\/g, '/')
    if (isAbsolute(path) || path.split('/').some((part) => part === '..') || isHiddenPathRel(path) || !isWithinProject(workDir, path)) {
      throw new Error(`附件路径必须是当前项目内的非隐藏相对路径: ${path}`)
    }
    const metadata = inspectFile(workDir, path)
    if (!metadata) throw new Error(`附件不存在或不在项目目录内: ${path}`)
    const key = metadata.path.toLowerCase()
    if (seen.has(key)) throw new Error(`附件路径重复: ${metadata.path}`)
    seen.add(key)
    return { path: metadata.path, title: optionalText(record.title, 160) ?? metadata.name, kind: metadata.kind }
  })
}

function isWithinProject(workDir: string, filePath: string): boolean {
  try {
    const root = realpathSync(resolve(workDir))
    const target = realpathSync(resolve(workDir, filePath))
    const rel = relative(root, target)
    return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
  } catch {
    return false
  }
}

function parseStringArray(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 50) throw new Error('sourceRefs 最多 50 项')
  return value.map((item, index) => requiredText(item, `sourceRefs[${index}]`, 500))
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 不能为空`)
  const text = value.trim()
  if (text.length > maxLength) throw new Error(`${field} 最多 ${maxLength} 个字符`)
  return text
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length > maxLength) throw new Error('文本参数格式错误')
  return value.trim()
}

function enumText<T extends string>(value: unknown, values: readonly T[]): T | undefined {
  return typeof value === 'string' && values.includes(value as T) ? value as T : undefined
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}
