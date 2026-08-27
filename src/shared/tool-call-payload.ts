import type { ToolCallContentItem, ToolCallData } from '../types/ws-protocol.js'

export function lightweightToolCallPayload(toolCall: ToolCallData | undefined): ToolCallData | undefined {
  if (!toolCall?.content) return toolCall
  let changed = false
  const content = toolCall.content.map((item): ToolCallContentItem => {
    if (item.type !== 'diff') return item
    changed = true
    return { type: 'diff', ...(item.path ? { path: item.path } : {}) }
  })
  return changed ? { ...toolCall, content } : toolCall
}
