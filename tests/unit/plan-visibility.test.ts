import { describe, expect, test } from 'vitest'
import { shouldShowPlanBar } from '../../ui/src/components/chat/plan-visibility.ts'
import type { PlanEntry } from '../../ui/src/stores/session-events.ts'

const completedPlan: PlanEntry[] = [
  { content: 'write test', status: 'completed', priority: 'medium' },
  { content: 'ship fix', status: 'completed', priority: 'medium' },
]

describe('shouldShowPlanBar', () => {
  test('hides completed plans after the assistant stops', () => {
    expect(shouldShowPlanBar({ plan: completedPlan, isStreaming: false, hasBlockingInteraction: false })).toBe(false)
  })

  test('hides stale active plans after the assistant stops', () => {
    expect(
      shouldShowPlanBar({
        plan: [...completedPlan, { content: 'verify', status: 'in_progress', priority: 'medium' }],
        isStreaming: false,
        hasBlockingInteraction: false,
      }),
    ).toBe(false)
  })

  test('shows plan context while the assistant is streaming or waiting for interaction', () => {
    expect(shouldShowPlanBar({ plan: completedPlan, isStreaming: true, hasBlockingInteraction: false })).toBe(true)
    expect(shouldShowPlanBar({ plan: completedPlan, isStreaming: false, hasBlockingInteraction: true })).toBe(true)
    expect(shouldShowPlanBar({ plan: [], isStreaming: true, hasBlockingInteraction: false })).toBe(false)
  })
})
