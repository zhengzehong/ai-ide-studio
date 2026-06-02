import type { ToolCallContentItem, ToolCallData, ToolCallDetailData, ToolCallSummaryData } from '../types/ws-protocol.js'

const PREVIEW_LIMIT = 20_000
const SUMMARY_PREVIEW_LIMIT = 160
const PROGRESS_TAIL_COUNT = 6
const CONTENT_PREVIEW_LIMIT = 20

interface PreviewResult {
  text?: string
  truncated: boolean
}

export function parseToolCallsJson(raw: string | null): ToolCallData[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter(isToolCallData) : []
  } catch {
    return []
  }
}

export function countToolCalls(raw: string | null): number | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.length : undefined
  } catch {
    return undefined
  }
}

export function summarizeToolCalls(toolCalls: ToolCallData[]): ToolCallSummaryData[] {
  return toolCalls.map((tool) => ({
    id: tool.id,
    title: tool.title || `工具调用 #${tool.id.slice(-6)}`,
    kind: tool.kind,
    status: tool.status,
    hasRawInput: tool.rawInput !== undefined,
    hasRawOutput: tool.rawOutput !== undefined,
    hasTerminalOutput: !!tool.terminalOutput,
    outputPreview: summaryPreview(tool),
    error: tool.error,
  }))
}

export function selectToolCallDetail(toolCalls: ToolCallData[], toolCallId: string): ToolCallDetailData | undefined {
  const tool = toolCalls.find((item) => item.id === toolCallId)
  if (!tool) return undefined

  const rawInput = previewValue(tool.rawInput, PREVIEW_LIMIT)
  const rawOutput = previewValue(tool.rawOutput, PREVIEW_LIMIT)
  const terminalOutput = previewTextTail(tool.terminalOutput, PREVIEW_LIMIT)
  const progress = tool.progress ?? []

  return {
    id: tool.id,
    title: tool.title || `工具调用 #${tool.id.slice(-6)}`,
    kind: tool.kind,
    status: tool.status,
    locations: tool.locations,
    rawInputPreview: rawInput.text,
    rawInputTruncated: rawInput.truncated,
    rawOutputPreview: rawOutput.text,
    rawOutputTruncated: rawOutput.truncated,
    terminalOutputTail: terminalOutput.text,
    terminalOutputTruncated: terminalOutput.truncated,
    contentPreview: previewContent(tool.content),
    contentTruncated: (tool.content?.length ?? 0) > CONTENT_PREVIEW_LIMIT,
    progressTail: progress.slice(-PROGRESS_TAIL_COUNT),
    progressTruncated: progress.length > PROGRESS_TAIL_COUNT,
    error: tool.error,
  }
}

export function previewValue(value: unknown, limit = PREVIEW_LIMIT): PreviewResult {
  if (value === undefined || value === null) return { truncated: false }
  const text = typeof value === 'string' ? value : safeStringify(value)
  return previewText(text, limit)
}

function summaryPreview(tool: ToolCallData): string | undefined {
  if (tool.error) return tool.error.slice(0, SUMMARY_PREVIEW_LIMIT)
  if (tool.rawOutput !== undefined) return previewValue(tool.rawOutput, SUMMARY_PREVIEW_LIMIT).text
  if (tool.terminalOutput) return previewTextTail(tool.terminalOutput, SUMMARY_PREVIEW_LIMIT).text
  const textContent = tool.content?.find((item) => item.text)?.text
  if (textContent) return previewText(textContent, SUMMARY_PREVIEW_LIMIT).text
  return undefined
}

function previewText(text: string, limit: number): PreviewResult {
  if (text.length <= limit) return { text, truncated: false }
  return { text: text.slice(0, limit), truncated: true }
}

function previewTextTail(text: string | undefined, limit: number): PreviewResult {
  if (!text) return { truncated: false }
  if (text.length <= limit) return { text, truncated: false }
  return { text: text.slice(-limit), truncated: true }
}

function previewContent(content: ToolCallContentItem[] | undefined): ToolCallContentItem[] | undefined {
  if (!content?.length) return undefined
  return content.slice(0, CONTENT_PREVIEW_LIMIT).map((item) => ({
    ...item,
    text: item.text ? previewText(item.text, PREVIEW_LIMIT).text : item.text,
    oldText: item.oldText ? previewText(item.oldText, PREVIEW_LIMIT).text : item.oldText,
    newText: item.newText ? previewText(item.newText, PREVIEW_LIMIT).text : item.newText,
  }))
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function isToolCallData(value: unknown): value is ToolCallData {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string'
}
