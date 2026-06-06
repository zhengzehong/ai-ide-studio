import type { TurnProcessBlock } from '../../stores/turn-blocks'

export function processBlockNeedsDetail(block: TurnProcessBlock): boolean {
  if (!('hasDetail' in block) || !block.hasDetail) return false

  switch (block.kind) {
    case 'tool':
      return block.toolCall.rawInput === undefined &&
        block.toolCall.rawOutput === undefined &&
        block.toolCall.terminalOutput === undefined &&
        block.toolCall.content === undefined &&
        block.toolCall.progress === undefined &&
        block.toolCall.error === undefined
    case 'file_change':
      return !block.changes
    case 'plan':
      return block.plan.length === 0
    case 'permission':
      return !block.request
    case 'elicitation':
      return !block.request
    default:
      return false
  }
}
