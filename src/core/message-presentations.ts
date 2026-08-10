export interface PreviewPresentation {
  kind: 'preview'
  previewId: string
  url: string
  title: string
  target: 'pc' | 'app'
  taskId: string | null
  createdAt: string
}

export interface FilePresentationEntry {
  path: string
  title: string
  name: string
  extension: string
  size: number
  kind: 'text' | 'image' | 'audio' | 'video' | 'binary'
  language: string
}

export interface FilesPresentation {
  kind: 'files'
  presentationId: string
  projectId: string
  title: string
  files: FilePresentationEntry[]
  createdAt: string
}

export type MessagePresentation = PreviewPresentation | FilesPresentation

const PREVIEW_TOOL_TITLES = new Set([
  'preview.publish',
  'mcp__ai-ide-tools__preview_publish',
  'mcp.ai-ide-tools.preview.publish',
  'ai-ide-tools.preview.publish',
])

const FILES_TOOL_TITLES = new Set([
  'files.present',
  'mcp__ai-ide-tools__files_present',
  'mcp.ai-ide-tools.files.present',
  'ai-ide-tools.files.present',
])

export type PlatformPresentationToolName = 'files.present' | 'preview.publish'

export function presentationsJsonFromToolCalls(toolCalls: unknown[] | undefined): string | null {
  const presentations = presentationsFromToolCalls(toolCalls)
  return presentations.length > 0 ? JSON.stringify(presentations) : null
}

export function presentationsFromToolCalls(toolCalls: unknown[] | undefined): MessagePresentation[] {
  if (!toolCalls?.length) return []
  return deduplicatePresentations(toolCalls
    .map(presentationFromToolCall)
    .filter((item): item is MessagePresentation => item !== null))
}

export function parsePresentationsJson(raw: string | null | undefined): MessagePresentation[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return []
    return deduplicatePresentations(value.map(parsePresentation).filter((item): item is MessagePresentation => item !== null))
  } catch {
    return []
  }
}

function deduplicatePresentations(items: MessagePresentation[]): MessagePresentation[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const id = item.kind === 'preview' ? item.previewId : item.presentationId
    const key = `${item.kind}:${id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function presentationFromToolCall(value: unknown): MessagePresentation | null {
  const toolCall = record(value)
  if (!toolCall || toolCall.status !== 'completed') return null
  const toolName = platformPresentationToolName(toolCall)
  const output = unwrapToolOutput(toolCall.rawOutput)
  if (toolName === 'preview.publish') return parsePreviewPresentation(output)
  if (toolName === 'files.present') return parseFilesPresentation(output)
  return null
}

export function platformPresentationToolName(value: unknown): PlatformPresentationToolName | null {
  const toolCall = record(value)
  if (!toolCall) return null
  const rawInput = record(toolCall.rawInput)
  if (rawInput?.server === 'ai-ide-tools') {
    const rawTool = text(rawInput.tool)
    if (rawTool === 'files.present' || rawTool === 'preview.publish') return rawTool
  }
  const title = text(toolCall.title) ?? ''
  if (FILES_TOOL_TITLES.has(title)) return 'files.present'
  if (PREVIEW_TOOL_TITLES.has(title)) return 'preview.publish'
  return null
}

function parsePresentation(value: unknown): MessagePresentation | null {
  const item = record(value)
  if (item?.kind === 'preview') return parsePreviewPresentation(value)
  if (item?.kind === 'files') return parseFilesPresentation(value)
  return null
}

function parseFilesPresentation(value: unknown): FilesPresentation | null {
  const output = record(value)
  if (!output || output.error !== undefined || output.kind !== 'files') return null
  const presentationId = text(output.presentationId)
  const projectId = text(output.projectId)
  const title = text(output.title)
  const createdAt = text(output.createdAt)
  if (!presentationId || !projectId || !title || !createdAt || !Array.isArray(output.files)) return null
  const files = output.files.map(parseFileEntry).filter((file): file is FilePresentationEntry => file !== null)
  if (files.length < 1 || files.length > 20 || files.length !== output.files.length) return null
  return { kind: 'files', presentationId, projectId, title, files, createdAt }
}

function parseFileEntry(value: unknown): FilePresentationEntry | null {
  const file = record(value)
  if (!file) return null
  const path = text(file.path)
  const title = text(file.title)
  const name = text(file.name)
  const extension = typeof file.extension === 'string' ? file.extension : null
  const language = text(file.language)
  const size = typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0 ? file.size : null
  const kind = file.kind === 'text' || file.kind === 'image' || file.kind === 'audio'
    || file.kind === 'video' || file.kind === 'binary' ? file.kind : null
  if (!path || !title || !name || extension === null || !language || size === null || !kind) return null
  return { path, title, name, extension, size, kind, language }
}

function parsePreviewPresentation(value: unknown): PreviewPresentation | null {
  const output = record(value)
  if (!output || output.error !== undefined) return null
  const previewId = text(output.previewId)
  const title = text(output.title)
  const createdAt = text(output.createdAt)
  const target = output.target === 'pc' || output.target === 'app' ? output.target : null
  if (!previewId || !title || !createdAt || !target) return null
  return {
    kind: 'preview',
    previewId,
    url: text(output.url) ?? `/preview/${previewId}/`,
    title,
    target,
    taskId: text(output.taskId),
    createdAt,
  }
}

function unwrapToolOutput(value: unknown, depth = 0): unknown {
  if (depth > 4) return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const entry = record(item)
      if (entry?.type !== 'text' || typeof entry.text !== 'string') continue
      const parsed = parseJson(entry.text)
      if (parsed !== null) return unwrapToolOutput(parsed, depth + 1)
    }
    return null
  }
  if (typeof value === 'string') {
    const parsed = parseJson(value)
    return parsed === null ? null : unwrapToolOutput(parsed, depth + 1)
  }
  const output = record(value)
  if (!output) return value
  if ('error' in output && output.error != null) return null
  if (output.kind === 'files' || output.previewId) return output
  if ('result' in output) return unwrapToolOutput(output.result, depth + 1)
  if ('content' in output) return unwrapToolOutput(output.content, depth + 1)
  return value
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
