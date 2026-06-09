import { describe, expect, test } from 'vitest'
import { applyTurnEntry, createEmptyTurn } from '../../ui/src/stores/turn-blocks.ts'

describe('turn block reference stability', () => {
  test('keeps unchanged process block references when appending reply text', () => {
    const withThinking = applyTurnEntry(createEmptyTurn('turn-1'), { kind: 'thinking', text: 'think' })
    const withTool = applyTurnEntry(withThinking, {
      kind: 'toolCall',
      toolCall: { id: 'tool-1', title: 'Read', status: 'in_progress' },
    })

    const next = applyTurnEntry(withTool, { kind: 'reply', text: 'answer' })

    expect(next.processBlocks[0]).toBe(withTool.processBlocks[0])
    expect(next.processBlocks[1]).toBe(withTool.processBlocks[1])
  })

  test('replaces only the updated tool block on tool updates', () => {
    const withFirstTool = applyTurnEntry(createEmptyTurn('turn-1'), {
      kind: 'toolCall',
      toolCall: { id: 'tool-1', title: 'Read', status: 'completed' },
    })
    const withSecondTool = applyTurnEntry(withFirstTool, {
      kind: 'toolCall',
      toolCall: { id: 'tool-2', title: 'Write', status: 'in_progress' },
    })

    const next = applyTurnEntry(withSecondTool, {
      kind: 'toolUpdate',
      toolCall: { id: 'tool-2', title: 'Write', status: 'completed' },
    })

    expect(next.processBlocks[0]).toBe(withSecondTool.processBlocks[0])
    expect(next.processBlocks[1]).not.toBe(withSecondTool.processBlocks[1])
  })
})
