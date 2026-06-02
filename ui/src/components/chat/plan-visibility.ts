import type { PlanEntry } from '../../stores/session-events'

export function shouldShowPlanBar({
  plan,
  isStreaming,
  hasBlockingInteraction,
}: {
  plan: PlanEntry[]
  isStreaming: boolean
  hasBlockingInteraction: boolean
}): boolean {
  return plan.length > 0 && (isStreaming || hasBlockingInteraction)
}
