import type { ToolCallData } from '../types/ws-protocol.js'

const GENERIC_TOOL_TITLES = new Set(['工具调用', 'Tool call', 'tool call'])

function hasMeaningfulTitle(tool: ToolCallData): boolean {
  return !!tool.title && !GENERIC_TOOL_TITLES.has(tool.title) && !tool.title.startsWith('工具调用 #')
}

export function shouldCreateToolFromUpdate(update: ToolCallData): boolean {
  return !!(
    hasMeaningfulTitle(update) ||
    update.kind ||
    update.locations?.length ||
    update.rawInput !== undefined ||
    update.rawOutput !== undefined ||
    update.content?.length ||
    update.terminalOutput ||
    update.terminalOutputDelta ||
    update.progress?.length ||
    update.progressDelta ||
    update.error
  )
}

export function upsertToolCall(tools: ToolCallData[], update: ToolCallData, createIfMissing = true): ToolCallData[] {
  const idx = tools.findIndex(t => t.id === update.id)
  if (idx >= 0) {
    const next = [...tools]
    next[idx] = mergeToolCall(next[idx], update)
    return next
  }
  if (!createIfMissing || !shouldCreateToolFromUpdate(update)) return tools
  return [...tools, update]
}

export function mergeToolCall(existing: ToolCallData, update: ToolCallData): ToolCallData {
  const next: ToolCallData = { ...existing }

  if (hasMeaningfulTitle(update) || !hasMeaningfulTitle(next)) next.title = update.title
  if (update.kind) next.kind = update.kind
  if (update.status) next.status = update.status
  if (update.locations) next.locations = update.locations
  if (update.rawInput !== undefined) next.rawInput = update.rawInput
  if (update.rawOutput !== undefined) next.rawOutput = update.rawOutput
  if (update.content) next.content = update.content
  if (update.terminalOutput !== undefined) next.terminalOutput = update.terminalOutput
  if (update.terminalOutputDelta) next.terminalOutput = `${next.terminalOutput || ''}${update.terminalOutputDelta}`
  if (update.progress) next.progress = update.progress
  if (update.progressDelta) next.progress = [...(next.progress || []), update.progressDelta]
  if (update.error !== undefined) next.error = update.error

  return next
}
