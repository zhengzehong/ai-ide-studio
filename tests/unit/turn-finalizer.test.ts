import { describe, expect, test } from 'vitest'
import { createPendingTurn, finalizePendingTurn, updatePendingTurn } from '../../src/core/turn-finalizer.ts'

describe('turn finalizer', () => {
  test('stores only the last reply as final content and keeps earlier replies in process thinking/tools', () => {
    let turn = createPendingTurn()
    turn = updatePendingTurn(turn, { messageId: 'msg-1', contentDelta: '我先检查。' })
    turn = updatePendingTurn(turn, { messageId: 'msg-1', toolCall: { id: 'tool-1', title: '读文件', status: 'completed' } })
    turn = updatePendingTurn(turn, { messageId: 'msg-1', contentDelta: '还要验证。' })
    turn = updatePendingTurn(turn, { messageId: 'msg-1', toolCall: { id: 'tool-2', title: '查历史', status: 'completed' } })
    turn = updatePendingTurn(turn, { messageId: 'msg-1', contentDelta: '最终结论。' })

    const finalized = finalizePendingTurn(turn)

    expect(finalized).toEqual({
      messageId: 'msg-1',
      content: '最终结论。',
      thinking: null,
      toolCalls: [
        { id: 'tool-1', title: '读文件', status: 'completed' },
        { id: 'tool-2', title: '查历史', status: 'completed' },
      ],
    })
  })
})
