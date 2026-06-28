import { describe, expect, test } from 'vitest'
import { processBlockNeedsDetail } from '../../ui/src/components/chat/process-detail.ts'
import type { TurnProcessBlock } from '../../ui/src/stores/turn-blocks.ts'

describe('processBlockNeedsDetail', () => {
  test('requires detail for lightweight permission and elicitation blocks', () => {
    const permission = { id: 'perm-1', kind: 'permission', title: '????', hasDetail: true } satisfies TurnProcessBlock
    const elicitation = { id: 'ask-1', kind: 'elicitation', title: 'AI ??', hasDetail: true } satisfies TurnProcessBlock

    expect(processBlockNeedsDetail(permission)).toBe(true)
    expect(processBlockNeedsDetail(elicitation)).toBe(true)
  })

  test('does not reload permission and elicitation blocks that already contain request details', () => {
    const permission = {
      id: 'perm-1',
      kind: 'permission',
      title: '????',
      hasDetail: true,
      request: { id: 'perm-1', toolCall: { id: 'tool-1', title: 'filesystem.read_text_file' }, options: [] },
    } satisfies TurnProcessBlock
    const elicitation = {
      id: 'ask-1',
      kind: 'elicitation',
      title: 'AI ??',
      hasDetail: true,
      request: { id: 'ask-1', message: '?????' },
    } satisfies TurnProcessBlock

    expect(processBlockNeedsDetail(permission)).toBe(false)
    expect(processBlockNeedsDetail(elicitation)).toBe(false)
  })

  test('requires detail for lightweight tool, file-change, and empty plan blocks', () => {
    const tool = { id: 'tool-item-1', kind: 'tool', hasDetail: true, toolCall: { id: 'tool-1', title: 'filesystem.read_text_file' } } satisfies TurnProcessBlock
    const fileChange = { id: 'file-1', kind: 'file_change', hasDetail: true, summary: '?? 1 ???' } satisfies TurnProcessBlock
    const plan = { id: 'plan-1', kind: 'plan', hasDetail: true, plan: [], summary: '?? 2 ?' } satisfies TurnProcessBlock

    expect(processBlockNeedsDetail(tool)).toBe(true)
    expect(processBlockNeedsDetail(fileChange)).toBe(true)
    expect(processBlockNeedsDetail(plan)).toBe(true)
  })

  test('does not require detail for blocks that already contain full file or plan data', () => {
    const fileChange = {
      id: 'file-1',
      kind: 'file_change',
      hasDetail: true,
      changes: { files: [], totalAdded: 0, totalDeleted: 0 },
    } satisfies TurnProcessBlock
    const plan = {
      id: 'plan-1',
      kind: 'plan',
      hasDetail: true,
      plan: [{ content: '????', status: 'completed', priority: 'medium' }],
    } satisfies TurnProcessBlock

    expect(processBlockNeedsDetail(fileChange)).toBe(false)
    expect(processBlockNeedsDetail(plan)).toBe(false)
  })
})
