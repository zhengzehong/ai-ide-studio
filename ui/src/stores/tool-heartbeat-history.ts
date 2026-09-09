import type { TurnProcessBlock } from './turn-blocks'

/** Old ACP heartbeats were persisted as status-only tools with generated titles. */
export function filterLegacyHeartbeatBlocks(blocks: TurnProcessBlock[]): TurnProcessBlock[] {
  const realTools = new Set(blocks.flatMap((block) => block.kind === 'tool' && !placeholderParent(block) ? [block.toolCall.id] : []))
  return blocks.filter((block) => {
    const parent = placeholderParent(block)
    return !parent || !realTools.has(parent)
  })
}

function placeholderParent(block: TurnProcessBlock): string | undefined {
  if (block.kind !== 'tool') return undefined
  const tool = block.toolCall
  const parent = tool.id.match(/^(.+)-heartbeat-\d+$/)?.[1]
  if (!parent || tool.title !== `工具调用 #${tool.id.slice(-6)}` || tool.status !== 'in_progress') return undefined
  if (block.hasDetail || tool.kind || tool.rawInput != null || tool.rawOutput != null
    || tool.content?.length || tool.locations?.length || tool.terminalOutput || tool.terminalOutputDelta
    || tool.progress?.length || tool.progressDelta || tool.error) return undefined
  return parent
}
