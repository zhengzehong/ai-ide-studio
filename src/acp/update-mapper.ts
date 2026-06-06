import * as acp from '@agentclientprotocol/sdk'
import type { ToolCallContentItem, ToolCallData } from '../types/ws-protocol.js'
import { hasMeaningfulToolTitle } from '../core/tool-title.js'

export function contentBlockToText(block: acp.ContentBlock): string {
  if (block.type === 'text') return (block as acp.TextContent).text
  if (block.type === 'image') {
    const image = block as acp.ImageContent
    return image.uri ? `[图片](${image.uri})` : '[图片]'
  }
  if (block.type === 'resource_link') return `[资源](${(block as acp.ResourceLink).uri})`
  if (block.type === 'resource') return '[资源]'
  return JSON.stringify(block)
}

function extractMetaText(meta: unknown, key: string): string | undefined {
  if (!meta || typeof meta !== 'object') return undefined
  const value = (meta as Record<string, unknown>)[key]
  if (!value || typeof value !== 'object') return undefined
  const data = (value as Record<string, unknown>).data
  return typeof data === 'string' ? data : undefined
}

function extractTerminalOutput(update: { _meta?: unknown }): string | undefined {
  return extractMetaText(update._meta, 'terminal_output_delta') || extractMetaText(update._meta, 'terminal_output')
}

function extractProgress(update: { _meta?: unknown }): string | undefined {
  return extractMetaText(update._meta, 'mcp_output_delta')
}

export function mapToolCallContent(items?: acp.ToolCallContent[]): ToolCallContentItem[] | undefined {
  if (!items || items.length === 0) return undefined
  return items.map(item => {
    if (item.type === 'diff') {
      const d = item as acp.Diff & { type: string }
      return { type: 'diff' as const, path: d.path, oldText: d.oldText ?? undefined, newText: d.newText }
    }
    if (item.type === 'terminal') {
      const t = item as acp.Terminal & { type: string }
      return { type: 'terminal' as const, terminalId: t.terminalId }
    }
    const c = item as acp.Content & { type: string }
    const block = c.content
    return { type: 'text' as const, text: block.type === 'text' ? (block as acp.TextContent).text : JSON.stringify(block) }
  })
}

export function toolCallTitle(toolCall: { title?: string | null; locations?: acp.ToolCallLocation[] | null; rawInput?: unknown; toolCallId: string }): string {
  if (hasMeaningfulTitle(toolCall.title)) return toolCall.title
  const mcpTitle = mcpToolTitle(toolCall.rawInput)
  if (mcpTitle) return mcpTitle
  if (toolCall.locations?.[0]) return toolCall.locations[0].path.split(/[/\\]/).pop() || ''
  if (toolCall.rawInput && typeof toolCall.rawInput === 'object') {
    const inp = toolCall.rawInput as Record<string, unknown>
    if (inp.command) return `执行 ${String(inp.command).slice(0, 60)}`
    if (inp.path) return String(inp.path).split(/[/\\]/).pop() || ''
    if (inp.file_path) return String(inp.file_path).split(/[/\\]/).pop() || ''
  }
  return `工具调用 #${toolCall.toolCallId.slice(-6)}`
}

function hasMeaningfulTitle(title?: string | null): title is string {
  return hasMeaningfulToolTitle(title)
}

function mcpToolTitle(rawInput: unknown): string | undefined {
  const input = record(rawInput)
  if (!input) return undefined
  const tool = stringField(input, 'tool') || stringField(input, 'name')
  if (!tool) return undefined
  const server = stringField(input, 'server')
  return server ? `${server}.${tool}` : tool
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function mapToolCallUpdate(toolCall: acp.ToolCallUpdate): ToolCallData {
  return {
    id: toolCall.toolCallId,
    title: toolCallTitle(toolCall),
    kind: toolCall.kind ?? undefined,
    status: toolCall.status ?? undefined,
    locations: toolCall.locations?.map(l => ({ path: l.path, line: l.line ?? undefined })) ?? undefined,
    rawInput: toolCall.rawInput,
    rawOutput: toolCall.rawOutput,
    content: mapToolCallContent(toolCall.content ?? undefined),
    terminalOutputDelta: extractTerminalOutput(toolCall),
    progressDelta: extractProgress(toolCall),
  }
}
