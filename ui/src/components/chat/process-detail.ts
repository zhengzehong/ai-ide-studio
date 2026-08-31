import { useCallback, useState } from 'react'
import type { TurnProcessBlock } from '../../stores/turn-blocks'

export type ProcessThinkingOverrideValue = 'open' | 'closed'

export interface ProcessThinkingOverride {
  isStreaming: boolean
  value: ProcessThinkingOverrideValue
}

export function resolveProcessThinkingOpen(
  isStreaming: boolean,
  override: ProcessThinkingOverrideValue | null,
): boolean {
  return override === 'open' || (override !== 'closed' && isStreaming)
}

export function resolveProcessThinkingOverride(
  isStreaming: boolean,
  override: ProcessThinkingOverride | null,
): ProcessThinkingOverrideValue | null {
  return override?.isStreaming === isStreaming ? override.value : null
}

export function useProcessThinkingDisclosure(isStreaming: boolean): {
  open: boolean
  toggle: () => void
} {
  const [override, setOverride] = useState<ProcessThinkingOverride | null>(null)
  const open = resolveProcessThinkingOpen(
    isStreaming,
    resolveProcessThinkingOverride(isStreaming, override),
  )

  const toggle = useCallback((): void => {
    setOverride({ isStreaming, value: open ? 'closed' : 'open' })
  }, [isStreaming, open])

  return { open, toggle }
}

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
