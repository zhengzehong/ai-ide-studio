export interface PreviewPresentation {
  kind: 'preview'
  previewId: string
  url: string
  title: string
  target: 'pc' | 'app'
  taskId: string | null
  createdAt: string
}

const PREVIEW_TOOL_TITLES = new Set([
  'preview.publish',
  'mcp__ai-ide-tools__preview_publish',
])

export function presentationsJsonFromToolCalls(toolCalls: unknown[] | undefined): string | null {
  if (!toolCalls?.length) return null
  const presentations = toolCalls
    .map(previewPresentationFromToolCall)
    .filter((item): item is PreviewPresentation => item !== null)
  return presentations.length > 0 ? JSON.stringify(presentations) : null
}

export function parsePresentationsJson(raw: string | null | undefined): PreviewPresentation[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return []
    return value.map(parsePreviewPresentation).filter((item): item is PreviewPresentation => item !== null)
  } catch {
    return []
  }
}

function previewPresentationFromToolCall(value: unknown): PreviewPresentation | null {
  const toolCall = record(value)
  if (!toolCall || !PREVIEW_TOOL_TITLES.has(text(toolCall.title) ?? '')) return null
  if (toolCall.status !== 'completed') return null
  return parsePreviewPresentation(unwrapToolOutput(toolCall.rawOutput))
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

function unwrapToolOutput(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const item of value) {
      const entry = record(item)
      if (entry?.type !== 'text' || typeof entry.text !== 'string') continue
      const parsed = parseJson(entry.text)
      if (parsed !== null) return parsed
    }
    return null
  }
  if (typeof value === 'string') return parseJson(value)
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

